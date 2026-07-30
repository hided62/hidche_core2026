import { randomBytes } from 'node:crypto';

import { createGamePostgresConnector, type InputJsonValue, type TurnEngineEventCreateManyInput } from '@sammo-ts/infra';
import { asRecord } from '@sammo-ts/common';
import {
    buildScenarioBootstrap,
    resolveScenarioGeneralDeathMonth,
    type GeneralMeta,
    type ScenarioBootstrapWarning,
    type WorldSeedPayload,
} from '@sammo-ts/logic';

import type { MapLoaderOptions } from './mapLoader.js';
import { loadMapDefinitionByName } from './mapLoader.js';
import type { ScenarioLoaderOptions } from './scenarioLoader.js';
import { loadScenarioDefinitionById } from './scenarioLoader.js';
import type { UnitSetLoaderOptions } from './unitSetLoader.js';
import { loadUnitSetDefinitionByName } from './unitSetLoader.js';
import type { GeneralPoolLoaderOptions } from './generalPoolLoader.js';
import { loadGeneralPoolEntries } from './generalPoolLoader.js';
import { applyInitialChangeCityEvents } from '../turn/monthlyChangeCityAction.js';

const DEFAULT_TICK_SECONDS = 120 * 60;
const DEFAULT_GENERAL_GOLD = 1000;
const DEFAULT_GENERAL_RICE = 1000;
const DEFAULT_OPENING_PART_YEAR = 3;
const INTEGRATION_WORLD_SEED_ENV = 'INTEGRATION_WORLD_SEED';

const MINUTES_TO_MS = 60_000;

export interface ScenarioAutorunOptions {
    limitMinutes: number;
    options: Record<string, boolean>;
}

export interface ScenarioInstallOptions {
    turnTermMinutes?: number;
    sync?: boolean;
    fiction?: number;
    extend?: boolean;
    blockGeneralCreate?: number;
    npcMode?: number;
    showImgLevel?: number;
    tournamentTrig?: boolean;
    joinMode?: 'full' | 'onlyRandom';
    autorunUser?: ScenarioAutorunOptions | null;
    preopenAt?: Date | null;
    season?: number;
    serverId?: string;
}

export interface ScenarioSeedOptions {
    scenarioId: number;
    databaseUrl: string;
    scenarioOptions?: ScenarioLoaderOptions;
    mapOptions?: MapLoaderOptions;
    unitSetOptions?: UnitSetLoaderOptions;
    generalPoolOptions?: GeneralPoolLoaderOptions;
    resetTables?: boolean;
    now?: Date;
    tickSeconds?: number;
    installOptions?: ScenarioInstallOptions;
    includeNeutralNationInSeed?: boolean;
    defaultGeneralGold?: number;
    defaultGeneralRice?: number;
}

export interface ScenarioSeedResult {
    seed: WorldSeedPayload;
    warnings: ScenarioBootstrapWarning[];
}

const asJson = (value: unknown): InputJsonValue => value as InputJsonValue;

type RawQueryClient = {
    $queryRawUnsafe<T>(query: string): Promise<T>;
};

const resolveSchemaName = (databaseUrl: string): string => {
    try {
        return new URL(databaseUrl).searchParams.get('schema') ?? 'public';
    } catch {
        return 'public';
    }
};

const hasEventTable = async (prisma: RawQueryClient, schema: string): Promise<boolean> => {
    try {
        const result = await prisma.$queryRawUnsafe<Array<{ regclass: string | null }>>(
            `SELECT to_regclass('${schema}.event')::text as regclass`
        );
        return Array.isArray(result) && result.length > 0 && result[0]?.regclass !== null;
    } catch {
        return false;
    }
};

const formatDateTime = (date: Date): string => {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return [
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    ].join(' ');
};

const cutTurn = (date: Date, turnTermMinutes: number): Date => {
    const base = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 1, 0, 0, 0);
    base.setDate(base.getDate() - 1);
    const diffMinutes = Math.floor((date.getTime() - base.getTime()) / MINUTES_TO_MS);
    const alignedMinutes = diffMinutes - (diffMinutes % turnTermMinutes);
    return new Date(base.getTime() + alignedMinutes * MINUTES_TO_MS);
};

const cutDay = (date: Date, turnTermMinutes: number): { startTime: Date; month: number; yearPulled: boolean } => {
    const base = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 1, 0, 0, 0);
    base.setDate(base.getDate() - 1);
    const baseGap = 12 * turnTermMinutes;
    const diffMinutes = Math.floor((date.getTime() - base.getTime()) / MINUTES_TO_MS);
    const timeAdjust = diffMinutes % baseGap;
    const month = Math.floor(timeAdjust / turnTermMinutes) + 1;
    const yearPulled = month > 3;
    const alignedMinutes = diffMinutes - timeAdjust + (yearPulled ? baseGap : 0);
    return {
        startTime: new Date(base.getTime() + alignedMinutes * MINUTES_TO_MS),
        month,
        yearPulled,
    };
};

const resolveStartState = (
    scenarioStartYear: number | null,
    now: Date,
    turnTermMinutes: number,
    sync: boolean
): { startTime: Date; currentYear: number; currentMonth: number } => {
    const startYear = scenarioStartYear ?? 0;
    if (!sync) {
        return {
            startTime: cutTurn(now, turnTermMinutes),
            currentYear: startYear,
            currentMonth: 1,
        };
    }

    const { startTime, month, yearPulled } = cutDay(now, turnTermMinutes);
    return {
        startTime,
        currentYear: startYear - (yearPulled ? 1 : 0),
        currentMonth: month,
    };
};

const resolveGeneralAge = (startYear: number | null, birthYear: number): number => {
    if (startYear === null || birthYear <= 0) {
        return 20;
    }
    return Math.max(startYear - birthYear, 0);
};

const resolveKillturnFromDeathYear = (
    currentYear: number,
    currentMonth: number,
    deathYear: number,
    deathMonth: number,
    fallback: number
): number => {
    if (!Number.isFinite(deathYear) || deathYear <= 0) {
        return fallback;
    }
    const diff = (deathYear - currentYear) * 12 + (deathMonth - currentMonth);
    return Math.max(diff, 0);
};

const buildEventRows = (rows: unknown[], targetOverride?: string): TurnEngineEventCreateManyInput[] => {
    const result: TurnEngineEventCreateManyInput[] = [];

    for (const row of rows) {
        if (!Array.isArray(row)) {
            continue;
        }
        if (targetOverride) {
            const [condition, ...actions] = row;
            result.push({
                targetCode: targetOverride,
                priority: 0,
                condition: asJson(condition ?? null),
                action: asJson(actions),
                meta: asJson({ source: targetOverride }),
            });
            continue;
        }

        const [target, priority, condition, ...actions] = row;
        if (typeof target !== 'string' || typeof priority !== 'number') {
            continue;
        }
        result.push({
            targetCode: target,
            priority,
            condition: asJson(condition ?? null),
            action: asJson(actions),
            meta: asJson({ source: 'scenario' }),
        });
    }

    return result;
};

// 시나리오 초기 데이터를 로드해 DB에 저장한다.
export const seedScenarioToDatabase = async (options: ScenarioSeedOptions): Promise<ScenarioSeedResult> => {
    const install = options.installOptions;
    const scenario = await loadScenarioDefinitionById(options.scenarioId, options.scenarioOptions);
    const includeExtendedGeneral = install?.extend ?? true;
    const scenarioDefinition = includeExtendedGeneral ? scenario : { ...scenario, generalsEx: [] };
    const map = await loadMapDefinitionByName(scenario.config.environment.mapName, options.mapOptions);
    const unitSet = await loadUnitSetDefinitionByName(scenario.config.environment.unitSet, options.unitSetOptions);
    const targetGeneralPool =
        typeof scenario.config.map.targetGeneralPool === 'string' ? scenario.config.map.targetGeneralPool : null;
    const generalPoolEntries = targetGeneralPool
        ? await loadGeneralPoolEntries(targetGeneralPool, options.generalPoolOptions)
        : [];

    const { seed, warnings } = buildScenarioBootstrap({
        scenario: scenarioDefinition,
        map,
        unitSet,
        options: {
            includeNeutralNationInSeed: options.includeNeutralNationInSeed ?? true,
        },
    });
    seed.cities = applyInitialChangeCityEvents(seed.cities, seed.initialEvents);

    const connector = createGamePostgresConnector({ url: options.databaseUrl });
    const now = options.now ?? new Date();
    const tickSeconds =
        install?.turnTermMinutes !== undefined ? install.turnTermMinutes * 60 : options.tickSeconds ?? DEFAULT_TICK_SECONDS;
    const turnTermMinutes = Math.max(1, Math.round(tickSeconds / 60));
    const sync = install?.sync ?? false;
    const startState = resolveStartState(scenario.startYear ?? null, now, turnTermMinutes, sync);
    const generalGold = options.defaultGeneralGold ?? DEFAULT_GENERAL_GOLD;
    const generalRice = options.defaultGeneralRice ?? DEFAULT_GENERAL_RICE;

    const scenarioConst = asRecord(seed.scenarioConfig.const);
    if (
        typeof scenarioConst.openingPartYear !== 'number' ||
        Number.isNaN(scenarioConst.openingPartYear)
    ) {
        scenarioConst.openingPartYear = DEFAULT_OPENING_PART_YEAR;
    }
    const scenarioConfig = {
        ...seed.scenarioConfig,
        const: scenarioConst,
    };

    const worldConfig: Record<string, unknown> = {
        fiction: install?.fiction,
        fictionMode: install?.fiction === 0 ? '연의' : install?.fiction === 1 ? '가상' : undefined,
        joinMode: install?.joinMode,
        blockGeneralCreate: install?.blockGeneralCreate,
        npcMode: install?.npcMode,
        showImgLevel: install?.showImgLevel,
        tournamentTrig: install?.tournamentTrig,
        extendedGeneral: includeExtendedGeneral,
        turnTermMinutes: install?.turnTermMinutes,
        syncTurnTime: install?.sync,
    };

    const worldMeta: Record<string, unknown> = {
        scenarioId: options.scenarioId,
        scenarioMeta: seed.scenarioMeta,
        starttime: formatDateTime(startState.startTime),
        turntime: formatDateTime(now),
        opentime: formatDateTime(now),
        lastTurnTime: formatDateTime(now),
    };

    if (typeof install?.season === 'number' && Number.isFinite(install.season)) {
        worldMeta.season = Math.floor(install.season);
    }
    if (typeof install?.serverId === 'string' && install.serverId.trim()) {
        worldMeta.serverId = install.serverId.trim();
    }

    const integrationSeed = process.env[INTEGRATION_WORLD_SEED_ENV]?.trim();
    worldMeta.hiddenSeed =
        integrationSeed && integrationSeed.length > 0
            ? integrationSeed
            : randomBytes(16).toString('hex');

    if (install?.preopenAt) {
        worldMeta.preopenAt = formatDateTime(install.preopenAt);
    }

    if (install?.autorunUser) {
        worldMeta.autorun_user = {
            limit_minutes: install.autorunUser.limitMinutes,
            options: install.autorunUser.options,
        };
    }
    const archivedWorldMeta = { ...worldMeta };
    delete archivedWorldMeta.hiddenSeed;

    await connector.connect();
    try {
        const prisma = connector.prisma;
        const schema = resolveSchemaName(options.databaseUrl);
        const eventTableReady = await hasEventTable(prisma, schema);

        if (options.resetTables ?? true) {
            if (eventTableReady) {
                await prisma.event.deleteMany();
            }
            await prisma.selectPoolEntry.deleteMany();
            await prisma.generalTurn.deleteMany();
            await prisma.generalTurnRevision.deleteMany();
            await prisma.rankData.deleteMany();
            await prisma.generalAccessLog.deleteMany();
            await prisma.diplomacy.deleteMany();
            await prisma.general.deleteMany();
            await prisma.troop.deleteMany();
            await prisma.city.deleteMany();
            await prisma.nation.deleteMany();
            await prisma.worldState.deleteMany();
        }

        await prisma.worldState.create({
            data: {
                scenarioCode: String(options.scenarioId),
                currentYear: startState.currentYear,
                currentMonth: startState.currentMonth,
                tickSeconds,
                config: asJson({ ...scenarioConfig, ...worldConfig }),
                meta: asJson(worldMeta),
            },
        });

        if (generalPoolEntries.length > 0) {
            await prisma.selectPoolEntry.createMany({
                data: generalPoolEntries.map((entry) => ({
                    uniqueName: entry.uniqueName,
                    info: asJson(entry.info),
                })),
            });
        }

        if (typeof worldMeta.serverId === 'string' && worldMeta.serverId) {
            await prisma.gameHistory.upsert({
                where: { serverId: worldMeta.serverId },
                create: {
                    serverId: worldMeta.serverId,
                    date: now,
                    winnerNation: null,
                    map: scenario.config.environment.mapName ?? null,
                    season:
                        typeof worldMeta.season === 'number' && Number.isFinite(worldMeta.season)
                            ? Math.floor(worldMeta.season)
                            : 1,
                    scenario: options.scenarioId,
                    scenarioName: String(seed.scenarioMeta?.title ?? ''),
                    env: asJson({
                        config: scenarioConfig,
                        meta: archivedWorldMeta,
                    }),
                },
                update: {
                    date: now,
                    winnerNation: null,
                    map: scenario.config.environment.mapName ?? null,
                    season:
                        typeof worldMeta.season === 'number' && Number.isFinite(worldMeta.season)
                            ? Math.floor(worldMeta.season)
                            : 1,
                    scenario: options.scenarioId,
                    scenarioName: String(seed.scenarioMeta?.title ?? ''),
                    env: asJson({
                        config: scenarioConfig,
                        meta: archivedWorldMeta,
                    }),
                },
            });
        }

        if (seed.nations.length > 0) {
            await prisma.nation.createMany({
                data: seed.nations.map((nation) => ({
                    id: nation.id,
                    name: nation.name,
                    color: nation.color,
                    capitalCityId: nation.capitalCityId ?? null,
                    gold: nation.gold,
                    rice: nation.rice,
                    tech: nation.tech,
                    level: nation.level,
                    typeCode: nation.typeCode,
                    meta: asJson({
                        infoText: nation.infoText,
                        cityIds: nation.cityIds,
                    }),
                })),
            });
        }

        if (seed.cities.length > 0) {
            await prisma.city.createMany({
                data: seed.cities.map((city) => ({
                    id: city.id,
                    name: city.name,
                    level: city.level,
                    nationId: city.nationId,
                    supplyState: city.supplyState,
                    frontState: city.frontState,
                    population: city.population,
                    populationMax: city.populationMax,
                    agriculture: city.agriculture,
                    agricultureMax: city.agricultureMax,
                    commerce: city.commerce,
                    commerceMax: city.commerceMax,
                    security: city.security,
                    securityMax: city.securityMax,
                    trust: city.trust,
                    trade: city.trade,
                    defence: city.defence,
                    defenceMax: city.defenceMax,
                    wall: city.wall,
                    wallMax: city.wallMax,
                    region: city.region,
                    conflict: asJson({}),
                    meta: asJson({
                        position: city.position,
                        connections: city.connections,
                        state: city.state,
                        ...city.meta,
                    }),
                })),
            });
        }

        if (seed.generals.length > 0) {
            await prisma.general.createMany({
                data: seed.generals.map((general) => ({
                    id: general.id,
                    name: general.name,
                    nationId: general.nationId,
                    cityId: general.cityId,
                    npcState: general.npcType,
                    affinity: general.affinity,
                    bornYear: general.birthYear,
                    deadYear: general.deathYear,
                    picture: general.picture === null ? null : String(general.picture),
                    leadership: general.stats.leadership,
                    strength: general.stats.strength,
                    intel: general.stats.intelligence,
                    officerLevel: general.officerLevel,
                    gold: generalGold,
                    rice: generalRice,
                    crewTypeId: general.crewTypeId,
                    horseCode: general.horse ?? 'None',
                    weaponCode: general.weapon ?? 'None',
                    bookCode: general.book ?? 'None',
                    itemCode: general.item ?? 'None',
                    turnTime: now,
                    age: resolveGeneralAge(scenario.startYear ?? null, general.birthYear),
                    startAge: resolveGeneralAge(scenario.startYear ?? null, general.birthYear),
                    personalCode: general.personality ?? 'None',
                    specialCode: general.special ?? 'None',
                    special2Code: general.specialWar ?? 'None',
                    lastTurn: asJson({}),
                    meta: asJson(
                        (() => {
                            const meta = { ...general.meta } as Record<string, unknown>;
                            if (typeof meta.birthYear !== 'number' || !Number.isFinite(meta.birthYear)) {
                                meta.birthYear = general.birthYear;
                            }
                            delete meta.deathYear;
                            delete meta.deadYear;
                            const fallbackKillturn =
                                typeof meta.killturn === 'number' && Number.isFinite(meta.killturn) ? meta.killturn : 0;
                            const deathMonth =
                                typeof meta.deathMonth === 'number' &&
                                Number.isInteger(meta.deathMonth) &&
                                meta.deathMonth >= 1 &&
                                meta.deathMonth <= 12
                                    ? meta.deathMonth
                                    : resolveScenarioGeneralDeathMonth({
                                          scenarioTitle: String(seed.scenarioMeta?.title ?? ''),
                                          startYear: seed.scenarioMeta?.startYear ?? null,
                                          contextLabel:
                                              typeof meta.source === 'string' ? meta.source : 'general',
                                          generalId: general.id,
                                          generalName: general.name,
                                          deathYear: general.deathYear,
                                      });
                            const killturn = resolveKillturnFromDeathYear(
                                startState.currentYear,
                                startState.currentMonth,
                                general.deathYear,
                                deathMonth,
                                fallbackKillturn
                            );
                            return {
                                ...meta,
                                killturn,
                                deathMonth,
                                npcType: general.npcType,
                                crewTypeId: general.crewTypeId,
                            } satisfies GeneralMeta;
                        })()
                    ),
                    penalty: asJson({}),
                })),
            });
        }

        if (seed.troops.length > 0) {
            await prisma.troop.createMany({
                data: seed.troops.map((troop) => ({
                    troopLeaderId: troop.id,
                    nationId: troop.nationId,
                    name: troop.name,
                })),
            });
        }

        const diplomacyMap = new Map<
            string,
            { srcNationId: number; destNationId: number; state: number; term: number }
        >();
        const nationIds = seed.nations.map((nation) => nation.id);
        for (const srcNationId of nationIds) {
            for (const destNationId of nationIds) {
                if (srcNationId === destNationId) {
                    continue;
                }
                diplomacyMap.set(`${srcNationId}:${destNationId}`, {
                    srcNationId,
                    destNationId,
                    state: 2,
                    term: 0,
                });
            }
        }
        for (const row of seed.diplomacy) {
            diplomacyMap.set(`${row.fromNationId}:${row.toNationId}`, {
                srcNationId: row.fromNationId,
                destNationId: row.toNationId,
                state: row.state,
                term: row.durationMonths,
            });
            diplomacyMap.set(`${row.toNationId}:${row.fromNationId}`, {
                srcNationId: row.toNationId,
                destNationId: row.fromNationId,
                state: row.state,
                term: row.durationMonths,
            });
        }
        const diplomacyRows = Array.from(diplomacyMap.values());
        if (diplomacyRows.length > 0) {
            await prisma.diplomacy.createMany({
                data: diplomacyRows.map((row) => ({
                    srcNationId: row.srcNationId,
                    destNationId: row.destNationId,
                    stateCode: row.state,
                    term: row.term,
                    meta: asJson({}),
                })),
            });
        }

        const eventRows = buildEventRows(seed.events);
        if (eventRows.length > 0 && eventTableReady) {
            await prisma.event.createMany({
                data: eventRows,
            });
        }
    } finally {
        await connector.disconnect();
    }

    return { seed, warnings };
};
