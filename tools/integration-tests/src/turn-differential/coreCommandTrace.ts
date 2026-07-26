import { LiteHashDRBG, RandUtil, type RNG } from '@sammo-ts/common';
import {
    GENERAL_TURN_COMMAND_KEYS,
    NATION_TURN_COMMAND_KEYS,
    type MapDefinition,
    type Nation,
    type TurnCommandProfile,
    type UnitSetDefinition,
} from '@sammo-ts/logic';
import { InMemoryTurnWorld } from '@sammo-ts/game-engine/turn/inMemoryWorld.js';
import { createReservedTurnHandler } from '@sammo-ts/game-engine/turn/reservedTurnHandler.js';
import { InMemoryReservedTurnStore } from '@sammo-ts/game-engine/turn/reservedTurnStore.js';
import { loadUnitSetDefinitionByName } from '@sammo-ts/game-engine/scenario/unitSetLoader.js';
import { loadMapDefinitionByName } from '@sammo-ts/game-engine/scenario/mapLoader.js';
import type {
    TurnDiplomacy,
    TurnGeneral,
    TurnWorldSnapshot,
    TurnWorldState,
} from '@sammo-ts/game-engine/turn/types.js';
import { applyPersistedRankRowsToMeta, buildLegacyComparableRankRows } from '@sammo-ts/game-engine/turn/rankData.js';

import {
    canonicalizeTurnCommandArgs,
    type CanonicalTurnCommandTrace,
    type CanonicalTurnSnapshot,
} from './canonical.js';

interface GeneralCooldownSelector {
    generalId: number;
    actionName: string;
}

interface NationCooldownSelector {
    nationId: number;
    actionName: string;
}

export interface TurnCommandFixtureRequest {
    kind: 'general' | 'nation';
    actorGeneralId: number;
    action: string;
    args?: unknown;
    coreArgs?: unknown;
    setup?: {
        world?: {
            startYear?: number;
            initYear?: number;
            initMonth?: number;
            year?: number;
            month?: number;
            hiddenSeed?: string;
        };
        isolateWorld?: boolean;
        generals?: Array<Record<string, unknown>>;
        rankData?: Array<{ generalId: number; type: string; value: number }>;
        nations?: Array<Record<string, unknown>>;
        cities?: Array<Record<string, unknown>>;
        troops?: Array<Record<string, unknown>>;
        diplomacy?: Array<Record<string, unknown>>;
        randomFoundingCandidateCityIds?: number[];
        generalCooldowns?: Array<GeneralCooldownSelector & { nextAvailableTurn: number }>;
    };
    observe?: {
        generalIds?: number[];
        cityIds?: number[];
        nationIds?: number[];
        logAfterId?: number;
        messageAfterId?: number;
        includeNationHistoryLogs?: boolean;
        includeGlobalHistoryLogs?: boolean;
        generalCooldowns?: GeneralCooldownSelector[];
        nationCooldowns?: NationCooldownSelector[];
        diplomacyPairs?: Array<{ fromNationId: number; toNationId: number }>;
    };
}

interface RandomCall {
    seq: number;
    operation: string;
    arguments: Record<string, unknown>;
    result: unknown;
}

class TracingRng implements RNG {
    public readonly calls: RandomCall[] = [];

    public constructor(private readonly inner: RNG) {}

    public getMaxInt(): number {
        return this.inner.getMaxInt();
    }

    public nextBytes(bytes: number): Uint8Array<ArrayBuffer> {
        const result = this.inner.nextBytes(bytes);
        this.record('nextBytes', { bytes }, Buffer.from(result).toString('hex'));
        return result;
    }

    public nextBits(bits: number): Uint8Array<ArrayBuffer> {
        const result = this.inner.nextBits(bits);
        this.record('nextBits', { bits }, Buffer.from(result).toString('hex'));
        return result;
    }

    public nextInt(max?: number): number {
        const result = this.inner.nextInt(max);
        this.record('nextInt', { maxInclusive: max ?? null }, result);
        return result;
    }

    public nextFloat1(): number {
        const result = this.inner.nextFloat1();
        this.record('nextFloat1', {}, result);
        return result;
    }

    private record(operation: string, args: Record<string, unknown>, result: unknown): void {
        this.calls.push({
            seq: this.calls.length,
            operation,
            arguments: args,
            result,
        });
    }
}

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asNumberRecord = (value: unknown): Record<string, number> =>
    Object.fromEntries(
        Object.entries(asRecord(value)).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    );

const readNumber = (record: Record<string, unknown>, key: string, fallback = 0): number => {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const readString = (record: Record<string, unknown>, key: string, fallback: string): string => {
    const value = record[key];
    return typeof value === 'string' ? value : fallback;
};

const readNullableString = (record: Record<string, unknown>, key: string): string | null => {
    const value = record[key];
    return typeof value === 'string' && value !== '' && value !== 'None' ? value : null;
};

const toDatabaseInt = (value: number): number => Math.round(value);

const COMMANDS_WITH_LEGACY_CORE_ARG_KEYS = new Set([
    'che_장수대상임관',
    'che_선양',
    'che_증여',
    'che_천도',
    'che_몰수',
]);

const resolveCoreArgs = (request: TurnCommandFixtureRequest): Record<string, unknown> => {
    const explicit = request.coreArgs;
    if (explicit !== undefined) {
        return asRecord(explicit);
    }
    if (COMMANDS_WITH_LEGACY_CORE_ARG_KEYS.has(request.action)) {
        return asRecord(request.args);
    }
    return asRecord(canonicalizeTurnCommandArgs(request.args ?? {}));
};

const createCommandProfile = (request: TurnCommandFixtureRequest): TurnCommandProfile => {
    if (request.kind === 'general') {
        if (!GENERAL_TURN_COMMAND_KEYS.includes(request.action as (typeof GENERAL_TURN_COMMAND_KEYS)[number])) {
            throw new Error(`Unknown general command: ${request.action}`);
        }
        const generalActions = [request.action, '휴식', 'che_인재탐색', 'che_해산', 'che_이동'] as Array<
            (typeof GENERAL_TURN_COMMAND_KEYS)[number]
        >;
        return {
            general: [...new Set(generalActions)],
            nation: ['휴식'],
        };
    }
    if (!NATION_TURN_COMMAND_KEYS.includes(request.action as (typeof NATION_TURN_COMMAND_KEYS)[number])) {
        throw new Error(`Unknown nation command: ${request.action}`);
    }
    return {
        general: ['휴식'],
        nation: [request.action as (typeof NATION_TURN_COMMAND_KEYS)[number], '휴식'],
    };
};

const buildGeneral = (row: Record<string, unknown>, fallbackTurnTime: Date): TurnGeneral => {
    const meta = asRecord(row.meta);
    const rawTurnTime = row.turnTime;
    const parsedTurnTime = typeof rawTurnTime === 'string' ? new Date(rawTurnTime) : fallbackTurnTime;
    const turnTime = Number.isNaN(parsedTurnTime.getTime()) ? fallbackTurnTime : parsedTurnTime;
    const rawLastTurn = asRecord(row.lastTurn);
    const lastTurn =
        typeof rawLastTurn.command === 'string'
            ? {
                  command: rawLastTurn.command,
                  ...(typeof rawLastTurn.term === 'number' ? { term: rawLastTurn.term } : {}),
                  ...(typeof rawLastTurn.seq === 'number' ? { seq: rawLastTurn.seq } : {}),
                  ...(Object.keys(asRecord(rawLastTurn.arg)).length > 0 ? { arg: asRecord(rawLastTurn.arg) } : {}),
              }
            : undefined;
    return {
        id: readNumber(row, 'id'),
        name: readString(row, 'name', '장수'),
        nationId: readNumber(row, 'nationId'),
        cityId: readNumber(row, 'cityId'),
        troopId: readNumber(row, 'troopId'),
        stats: {
            leadership: readNumber(row, 'leadership', 80),
            strength: readNumber(row, 'strength', 70),
            intelligence: readNumber(row, 'intelligence', 60),
        },
        experience: readNumber(row, 'experience'),
        dedication: readNumber(row, 'dedication'),
        officerLevel: readNumber(row, 'officerLevel', 1),
        role: {
            personality: readNullableString(row, 'personality'),
            specialDomestic: readNullableString(row, 'specialDomestic'),
            specialWar: readNullableString(row, 'specialWar'),
            items: {
                horse: readNullableString(row, 'itemHorse'),
                weapon: readNullableString(row, 'itemWeapon'),
                book: readNullableString(row, 'itemBook'),
                item: readNullableString(row, 'itemExtra'),
            },
        },
        injury: readNumber(row, 'injury'),
        gold: readNumber(row, 'gold'),
        rice: readNumber(row, 'rice'),
        crew: readNumber(row, 'crew'),
        crewTypeId: readNumber(row, 'crewTypeId', 1100),
        train: readNumber(row, 'train'),
        atmos: readNumber(row, 'atmos'),
        age: readNumber(row, 'age', 30),
        npcState: readNumber(row, 'npcState'),
        triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
        meta: {
            ...meta,
            killturn: readNumber(row, 'killTurn', readNumber(meta, 'killturn', 24)),
            leadership_exp: readNumber(row, 'leadershipExp', readNumber(meta, 'leadership_exp')),
            strength_exp: readNumber(row, 'strengthExp', readNumber(meta, 'strength_exp')),
            intel_exp: readNumber(row, 'intelExp', readNumber(meta, 'intel_exp')),
            dex1: readNumber(row, 'dex1', readNumber(meta, 'dex1')),
            dex2: readNumber(row, 'dex2', readNumber(meta, 'dex2')),
            dex3: readNumber(row, 'dex3', readNumber(meta, 'dex3')),
            dex4: readNumber(row, 'dex4', readNumber(meta, 'dex4')),
            dex5: readNumber(row, 'dex5', readNumber(meta, 'dex5')),
            explevel: readNumber(row, 'expLevel', readNumber(meta, 'explevel')),
            betray: readNumber(row, 'betray', readNumber(meta, 'betray')),
            officerCityId: readNumber(
                row,
                'officerCityId',
                readNumber(meta, 'officerCityId', readNumber(meta, 'officerCity', readNumber(meta, 'officer_city')))
            ),
            officerCity: readNumber(
                row,
                'officerCityId',
                readNumber(meta, 'officerCity', readNumber(meta, 'officer_city'))
            ),
            officer_city: readNumber(
                row,
                'officerCityId',
                readNumber(meta, 'officer_city', readNumber(meta, 'officerCity'))
            ),
            block: readNumber(row, 'blockState', readNumber(meta, 'block')),
        },
        ...(lastTurn ? { lastTurn } : {}),
        turnTime,
        recentWarTime: null,
    };
};

const buildNation = (row: Record<string, unknown>, generals: TurnGeneral[]): Nation => {
    const id = readNumber(row, 'id');
    const meta = asRecord(row.meta);
    const turnLastByOfficerLevel = asRecord(row.turnLastByOfficerLevel);
    return {
        id,
        name: readString(row, 'name', `국가${id}`),
        color: readString(row, 'color', '#777777'),
        capitalCityId: readNumber(row, 'capitalCityId'),
        chiefGeneralId: generals.find((general) => general.nationId === id && general.officerLevel === 12)?.id ?? null,
        gold: readNumber(row, 'gold'),
        rice: readNumber(row, 'rice'),
        power: readNumber(row, 'power'),
        level: readNumber(row, 'level', 1),
        typeCode: readString(row, 'typeCode', 'che_중립'),
        meta: {
            ...meta,
            ...Object.fromEntries(
                Object.entries(turnLastByOfficerLevel).map(([officerLevel, lastTurn]) => [
                    `turn_last_${officerLevel}`,
                    lastTurn,
                ])
            ),
            tech: readNumber(row, 'tech', readNumber(meta, 'tech')),
            gennum: readNumber(row, 'generalCount', readNumber(meta, 'gennum')),
            war: readNumber(row, 'war', readNumber(meta, 'war')),
            surlimit: readNumber(row, 'diplomacyLimit', readNumber(meta, 'surlimit')),
            capset: readNumber(row, 'capitalRevision', readNumber(meta, 'capset')),
            strategic_cmd_limit: readNumber(row, 'strategicCommandLimit', readNumber(meta, 'strategic_cmd_limit')),
        },
    };
};

const buildWorldInput = (
    request: TurnCommandFixtureRequest,
    referenceBefore: CanonicalTurnSnapshot,
    unitSet: UnitSetDefinition,
    map: MapDefinition
): { state: TurnWorldState; snapshot: TurnWorldSnapshot; map: MapDefinition } => {
    const year = readNumber(referenceBefore.world, 'year', request.setup?.world?.year ?? 185);
    const month = readNumber(referenceBefore.world, 'month', request.setup?.world?.month ?? 1);
    const turnTime = new Date(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`);
    const generals = referenceBefore.generals.map((row) => buildGeneral(row, turnTime));
    for (const general of generals) {
        applyPersistedRankRowsToMeta(
            general.meta,
            referenceBefore.rankData
                .filter((row) => readNumber(row, 'generalId') === general.id)
                .map((row) => ({
                    type: readString(row, 'type', ''),
                    value: readNumber(row, 'value'),
                }))
        );
    }
    const referenceGeneralCooldowns = Array.isArray(referenceBefore.world.generalCooldowns)
        ? referenceBefore.world.generalCooldowns
        : [];
    for (const rawCooldown of referenceGeneralCooldowns) {
        const cooldown = asRecord(rawCooldown);
        const generalId = readNumber(cooldown, 'generalId');
        const actionName = readString(cooldown, 'actionName', '');
        const nextAvailableTurn = cooldown.nextAvailableTurn;
        const general = generals.find((entry) => entry.id === generalId);
        if (general && actionName && typeof nextAvailableTurn === 'number' && Number.isFinite(nextAvailableTurn)) {
            general.meta[`next_execute_${actionName}`] = nextAvailableTurn;
        }
    }
    const fixtureNations = new Map((request.setup?.nations ?? []).map((row) => [readNumber(row, 'id'), row] as const));
    const nations = referenceBefore.nations.map((row) =>
        buildNation(
            {
                ...row,
                turnLastByOfficerLevel:
                    fixtureNations.get(readNumber(row, 'id'))?.coreTurnLastByOfficerLevel ??
                    fixtureNations.get(readNumber(row, 'id'))?.turnLastByOfficerLevel,
            },
            generals
        )
    );
    const referenceNationCooldowns = Array.isArray(referenceBefore.world.nationCooldowns)
        ? referenceBefore.world.nationCooldowns
        : [];
    for (const rawCooldown of referenceNationCooldowns) {
        const cooldown = asRecord(rawCooldown);
        const nationId = readNumber(cooldown, 'nationId');
        const actionName = readString(cooldown, 'actionName', '');
        const nextAvailableTurn = cooldown.nextAvailableTurn;
        const nation = nations.find((entry) => entry.id === nationId);
        if (nation && actionName && typeof nextAvailableTurn === 'number' && Number.isFinite(nextAvailableTurn)) {
            nation.meta[`next_execute_${actionName}`] = nextAvailableTurn;
        }
    }
    const observedCityRows = new Map(referenceBefore.cities.map((row) => [readNumber(row, 'id'), row] as const));
    const randomFoundingCandidateCityIds = request.setup?.randomFoundingCandidateCityIds
        ? new Set(request.setup.randomFoundingCandidateCityIds)
        : null;
    const diplomacy: TurnDiplomacy[] = referenceBefore.diplomacy.map((row) => ({
        fromNationId: readNumber(row, 'fromNationId'),
        toNationId: readNumber(row, 'toNationId'),
        state: readNumber(row, 'state', 3),
        term: readNumber(row, 'term'),
        dead: readNumber(row, 'dead'),
        meta: {},
    }));
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {
                develCost: readNumber(referenceBefore.world, 'develCost'),
                trainDelta: 30,
                atmosDelta: 30,
                maxTrainByCommand: 100,
                maxAtmosByCommand: 100,
                openingPartYear: 3,
                initialNationGenLimit: 10,
                maxGeneral: 500,
                baseGold: 0,
                baseRice: 2_000,
                generalMinimumGold: 0,
                generalMinimumRice: 500,
                npcSeizureMessageProb: 0.01,
                maxResourceActionAmount: 10_000,
                maxTechLevel: 12,
                maxLevel: 255,
                maxDedLevel: 30,
                upgradeLimit: 30,
            },
            environment: { mapName: map.id, unitSet: unitSet.id },
        },
        scenarioMeta: {
            title: '턴 명령 차등',
            startYear: request.setup?.world?.startYear ?? Math.max(1, year - 5),
            life: null,
            fiction: 0,
            history: [],
            ignoreDefaultEvents: false,
        },
        map,
        unitSet,
        nations,
        cities: map.cities.map((definition) => {
            const row = observedCityRows.get(definition.id) ?? {};
            return {
                id: definition.id,
                name: readString(row, 'name', definition.name),
                nationId: readNumber(row, 'nationId'),
                level: observedCityRows.has(definition.id)
                    ? readNumber(row, 'level', definition.level)
                    : randomFoundingCandidateCityIds === null
                      ? definition.level
                      : randomFoundingCandidateCityIds.has(definition.id)
                        ? 5
                        : 4,
                state: readNumber(row, 'state'),
                population: readNumber(row, 'population', definition.initial.population),
                populationMax: readNumber(row, 'populationMax', definition.max.population),
                agriculture: readNumber(row, 'agriculture', definition.initial.agriculture),
                agricultureMax: readNumber(row, 'agricultureMax', definition.max.agriculture),
                commerce: readNumber(row, 'commerce', definition.initial.commerce),
                commerceMax: readNumber(row, 'commerceMax', definition.max.commerce),
                security: readNumber(row, 'security', definition.initial.security),
                securityMax: readNumber(row, 'securityMax', definition.max.security),
                supplyState: readNumber(row, 'supplyState', map.defaults?.supplyState ?? 1),
                frontState: readNumber(row, 'frontState', map.defaults?.frontState ?? 0),
                defence: readNumber(row, 'defence', definition.initial.defence),
                defenceMax: readNumber(row, 'defenceMax', definition.max.defence),
                wall: readNumber(row, 'wall', definition.initial.wall),
                wallMax: readNumber(row, 'wallMax', definition.max.wall),
                conflict: asNumberRecord(row.conflict),
                meta: {
                    trust: readNumber(row, 'trust', map.defaults?.trust ?? 50),
                    trade: readNumber(row, 'trade', map.defaults?.trade ?? 100),
                    term: readNumber(row, 'term'),
                    officer_set: readNumber(row, 'officerSet'),
                },
            };
        }),
        generals,
        troops:
            request.setup?.troops?.map((row) => {
                const id = readNumber(row, 'id');
                return {
                    id,
                    nationId: readNumber(row, 'nationId'),
                    name: readString(row, 'name', `부대${id}`),
                };
            }) ?? [],
        diplomacy,
        events: [],
        initialEvents: [],
    };
    return {
        state: {
            id: 1,
            currentYear: year,
            currentMonth: month,
            tickSeconds: readNumber(referenceBefore.world, 'tickMinutes', 10) * 60,
            lastTurnTime: turnTime,
            meta: {
                hiddenSeed: request.setup?.world?.hiddenSeed ?? 'turn-command-differential-seed',
                killturn: readNumber(referenceBefore.world, 'killTurn', 24),
                isUnited: readNumber(referenceBefore.world, 'isUnited'),
                scenarioId: readNumber(referenceBefore.world, 'scenarioId'),
                initYear: readNumber(
                    referenceBefore.world,
                    'initYear',
                    request.setup?.world?.initYear ?? request.setup?.world?.startYear ?? year
                ),
                initMonth: readNumber(referenceBefore.world, 'initMonth', request.setup?.world?.initMonth ?? 1),
            },
        },
        snapshot,
        map,
    };
};

const projectWorld = (
    world: InMemoryTurnWorld,
    reservedTurns: InMemoryReservedTurnStore,
    logs: CanonicalTurnSnapshot['logs'],
    messages: CanonicalTurnSnapshot['messages'],
    selector: {
        generalIds: Set<number>;
        cityIds: Set<number>;
        nationIds: Set<number>;
        initialGeneralIds: Set<number>;
        generalCooldowns: GeneralCooldownSelector[];
        nationCooldowns: NationCooldownSelector[];
    }
): CanonicalTurnSnapshot => {
    const state = world.getState();
    const generals = world
        .listGenerals()
        .filter((general) => selector.generalIds.has(general.id))
        .map((general) => ({
            id: general.id,
            name: general.name,
            nationId: general.nationId,
            cityId: general.cityId,
            troopId: general.troopId,
            leadership: general.stats.leadership,
            strength: general.stats.strength,
            intelligence: general.stats.intelligence,
            experience: toDatabaseInt(general.experience),
            dedication: toDatabaseInt(general.dedication),
            expLevel: readNumber(general.meta, 'explevel'),
            officerLevel: general.officerLevel,
            officerCityId: readNumber(
                general.meta,
                'officer_city',
                readNumber(general.meta, 'officerCity', readNumber(general.meta, 'officerCityId'))
            ),
            betray: readNumber(general.meta, 'betray'),
            personality: general.role.personality,
            specialDomestic: general.role.specialDomestic,
            specialWar: general.role.specialWar,
            itemHorse: general.role.items.horse,
            itemWeapon: general.role.items.weapon,
            itemBook: general.role.items.book,
            itemExtra: general.role.items.item,
            injury: general.injury,
            gold: toDatabaseInt(general.gold),
            rice: toDatabaseInt(general.rice),
            crew: toDatabaseInt(general.crew),
            crewTypeId: general.crewTypeId,
            train: toDatabaseInt(general.train),
            atmos: toDatabaseInt(general.atmos),
            age: general.age,
            npcState: general.npcState,
            turnTime: general.turnTime.toISOString(),
            recentWarTime: general.recentWarTime?.toISOString() ?? null,
            lastTurn: general.lastTurn ?? null,
            meta: general.meta,
            leadershipExp: toDatabaseInt(readNumber(general.meta, 'leadership_exp')),
            strengthExp: toDatabaseInt(readNumber(general.meta, 'strength_exp')),
            intelExp: toDatabaseInt(readNumber(general.meta, 'intel_exp')),
            dex1: toDatabaseInt(readNumber(general.meta, 'dex1')),
            dex2: toDatabaseInt(readNumber(general.meta, 'dex2')),
            dex3: toDatabaseInt(readNumber(general.meta, 'dex3')),
            dex4: toDatabaseInt(readNumber(general.meta, 'dex4')),
            dex5: toDatabaseInt(readNumber(general.meta, 'dex5')),
            killTurn: readNumber(general.meta, 'killturn'),
            mySet: readNumber(general.meta, 'myset'),
        }));
    const nations = world.listNations();
    return {
        schemaVersion: 1,
        engine: 'core2026',
        world: {
            year: state.currentYear,
            month: state.currentMonth,
            tickMinutes: Math.max(1, Math.round(state.tickSeconds / 60)),
            turnTime: state.lastTurnTime.toISOString(),
            isUnited: readNumber(state.meta, 'isUnited'),
            generalCooldowns: selector.generalCooldowns.map(({ generalId, actionName }) => {
                const general = world.getGeneralById(generalId);
                const raw = general?.meta[`next_execute_${actionName}`];
                return {
                    generalId,
                    actionName,
                    nextAvailableTurn: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
                };
            }),
            nationCooldowns: selector.nationCooldowns.map(({ nationId, actionName }) => {
                const nation = world.getNationById(nationId);
                const raw = nation?.meta[`next_execute_${actionName}`];
                return {
                    nationId,
                    actionName,
                    nextAvailableTurn: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
                };
            }),
        },
        generals,
        rankData: world
            .listGenerals()
            .filter((general) => selector.generalIds.has(general.id))
            .flatMap((general) =>
                buildLegacyComparableRankRows(general).map((row) =>
                    selector.initialGeneralIds.has(general.id) ? row : { ...row, nationId: 0, value: 0 }
                )
            )
            .map((row) => ({ ...row })),
        cities: world
            .listCities()
            .filter((city) => selector.cityIds.has(city.id))
            .map((city) => ({
                id: city.id,
                name: city.name,
                nationId: city.nationId,
                level: city.level,
                population: toDatabaseInt(city.population),
                populationMax: city.populationMax,
                agriculture: toDatabaseInt(city.agriculture),
                agricultureMax: city.agricultureMax,
                commerce: toDatabaseInt(city.commerce),
                commerceMax: city.commerceMax,
                security: toDatabaseInt(city.security),
                securityMax: city.securityMax,
                supplyState: city.supplyState,
                frontState: city.frontState,
                defence: toDatabaseInt(city.defence),
                defenceMax: city.defenceMax,
                wall: toDatabaseInt(city.wall),
                wallMax: city.wallMax,
                conflict: city.conflict ?? {},
                state: city.state,
                term: readNumber(city.meta, 'term'),
                trust: readNumber(city.meta, 'trust'),
                trade: readNumber(city.meta, 'trade'),
                officerSet: readNumber(city.meta, 'officer_set'),
            })),
        nations: nations
            .filter((nation) => selector.nationIds.has(nation.id))
            .map((nation) => ({
                id: nation.id,
                name: nation.name,
                color: nation.color,
                capitalCityId: nation.capitalCityId,
                gold: toDatabaseInt(nation.gold),
                rice: toDatabaseInt(nation.rice),
                tech: readNumber(nation.meta, 'tech'),
                level: nation.level,
                typeCode: nation.typeCode,
                generalCount: world.listGenerals().filter((general) => general.nationId === nation.id).length,
                power: nation.power,
                war: readNumber(nation.meta, 'war'),
                diplomacyLimit: readNumber(nation.meta, 'surlimit'),
                capitalRevision: readNumber(nation.meta, 'capset'),
                strategicCommandLimit: readNumber(nation.meta, 'strategic_cmd_limit'),
                meta: nation.meta,
            })),
        diplomacy: world
            .listDiplomacy()
            .filter((entry) => selector.nationIds.has(entry.fromNationId) && selector.nationIds.has(entry.toNationId))
            .map((entry) => ({ ...entry })),
        generalTurns: generals.flatMap((general) =>
            reservedTurns.getGeneralTurns(Number(general.id)).map((turn, turnIndex) => ({
                generalId: general.id,
                turnIndex,
                action: turn.action,
                args: turn.args,
            }))
        ),
        nationTurns: nations.flatMap((nation) =>
            [12, 11, 10, 9, 8, 7, 6, 5].flatMap((officerLevel) =>
                reservedTurns.getNationTurns(nation.id, officerLevel).map((turn, turnIndex) => ({
                    nationId: nation.id,
                    officerLevel,
                    turnIndex,
                    action: turn.action,
                    args: turn.args,
                }))
            )
        ),
        logs,
        messages,
        watermarks: { logId: logs.length, historyLogId: logs.length, messageId: messages.length },
    };
};

const emptyDatabaseClient = {
    generalTurn: {
        findMany: async () => [],
        deleteMany: async () => ({ count: 0 }),
        createMany: async () => ({ count: 0 }),
    },
    nationTurn: {
        findMany: async () => [],
        deleteMany: async () => ({ count: 0 }),
        createMany: async () => ({ count: 0 }),
    },
};

export const runCoreTurnCommandTrace = async (
    request: TurnCommandFixtureRequest,
    referenceBefore: CanonicalTurnSnapshot
): Promise<CanonicalTurnCommandTrace> => {
    const unitSet = await loadUnitSetDefinitionByName('che');
    const map = await loadMapDefinitionByName('che');
    const worldInput = buildWorldInput(request, referenceBefore, unitSet, map);
    const { state, snapshot } = worldInput;
    const selector = {
        generalIds: new Set([
            ...referenceBefore.generals.map((row) => readNumber(row, 'id')),
            ...(request.observe?.generalIds ?? []),
        ]),
        cityIds: new Set(referenceBefore.cities.map((row) => readNumber(row, 'id'))),
        nationIds: new Set(referenceBefore.nations.map((row) => readNumber(row, 'id'))),
        initialGeneralIds: new Set(referenceBefore.generals.map((row) => readNumber(row, 'id'))),
        generalCooldowns: request.observe?.generalCooldowns ?? [],
        nationCooldowns: request.observe?.nationCooldowns ?? [],
    };
    const reservedTurns = new InMemoryReservedTurnStore(emptyDatabaseClient as never, {
        maxGeneralTurns: 10,
        maxNationTurns: 12,
    });
    await reservedTurns.loadAll();
    const actor = snapshot.generals.find((general) => general.id === request.actorGeneralId);
    if (!actor) {
        throw new Error(`Missing actor general ${request.actorGeneralId}`);
    }
    const args = resolveCoreArgs(request);
    if (request.kind === 'general') {
        reservedTurns.getGeneralTurns(actor.id)[0] = { action: request.action, args };
    } else {
        reservedTurns.getNationTurns(actor.nationId, actor.officerLevel)[0] = {
            action: request.action,
            args,
        };
    }

    let world: InMemoryTurnWorld | null = null;
    let resolution:
        | {
              kind: 'nation' | 'general';
              actionKey: string;
              requestedAction: string;
              usedFallback: boolean;
              blockedReason?: string;
          }
        | undefined;
    const commandRngCalls: RandomCall[] = [];
    const handler = await createReservedTurnHandler({
        reservedTurns,
        scenarioConfig: snapshot.scenarioConfig,
        scenarioMeta: snapshot.scenarioMeta,
        map,
        unitSet,
        getWorld: () => world,
        commandProfile: createCommandProfile(request),
        commandRngFactory: ({ kind, actionKey, seed }) => {
            const tracing = new TracingRng(new LiteHashDRBG(seed));
            if (kind === request.kind && actionKey === request.action) {
                commandRngCalls.push(...tracing.calls);
                return new RandUtil({
                    getMaxInt: () => tracing.getMaxInt(),
                    nextBytes: (bytes) => {
                        const result = tracing.nextBytes(bytes);
                        commandRngCalls.splice(0, commandRngCalls.length, ...tracing.calls);
                        return result;
                    },
                    nextBits: (bits) => {
                        const result = tracing.nextBits(bits);
                        commandRngCalls.splice(0, commandRngCalls.length, ...tracing.calls);
                        return result;
                    },
                    nextInt: (max) => {
                        const result = tracing.nextInt(max);
                        commandRngCalls.splice(0, commandRngCalls.length, ...tracing.calls);
                        return result;
                    },
                    nextFloat1: () => {
                        const result = tracing.nextFloat1();
                        commandRngCalls.splice(0, commandRngCalls.length, ...tracing.calls);
                        return result;
                    },
                });
            }
            return new RandUtil(new LiteHashDRBG(seed));
        },
        onActionResolved: (payload) => {
            if (payload.kind === request.kind && payload.requestedAction === request.action) {
                resolution = payload;
            }
        },
    });
    world = new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        generalTurnHandler: handler,
    });
    const before = projectWorld(world, reservedTurns, [], [], selector);
    world.executeGeneralTurn(actor);
    const dirty = world.peekDirtyState();
    const after = projectWorld(
        world,
        reservedTurns,
        dirty.logs.map((log, index) => ({
            id: index + 1,
            scope: log.scope,
            category: log.category,
            generalId: log.generalId ?? (log.scope === 'GENERAL' ? actor.id : undefined),
            nationId: log.nationId ?? (log.scope === 'NATION' ? actor.nationId : undefined),
            year: state.currentYear,
            month: state.currentMonth,
            text: log.text,
        })),
        dirty.messages.map((message, index) => ({
            id: index + 1,
            payload: message,
        })),
        selector
    );

    return {
        schemaVersion: 1,
        engine: 'core2026',
        execution: {
            kind: request.kind,
            actorGeneralId: request.actorGeneralId,
            action: request.action,
            args,
            seedDomain: request.kind === 'general' ? 'generalCommand' : 'nationCommand',
            outcome: resolution,
        },
        before,
        after,
        rng: commandRngCalls,
    };
};
