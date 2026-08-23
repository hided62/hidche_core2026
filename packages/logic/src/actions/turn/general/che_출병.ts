import type { City, General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    hasRouteWithEnemy,
    notBeNeutral,
    notOpeningPart,
    notSameDestCity,
    occupiedCity,
    reqGeneralCrew,
    reqGeneralRice,
    allowWar,
} from '@sammo-ts/logic/constraints/presets.js';
import { readGeneral } from '@sammo-ts/logic/constraints/helpers.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import {
    createCityPatchEffect,
    createDiplomacyPatchEffect,
    createGeneralPatchEffect,
    createMessageEffect,
    createNationPatchEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { JosaUtil, LiteHashDRBG } from '@sammo-ts/common';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type { WarAftermathConfig, WarEngineConfig, WarTimeContext } from '@sammo-ts/logic/war/types.js';
import { resolveWarAftermath } from '@sammo-ts/logic/war/aftermath.js';
import { resolveWarBattle } from '@sammo-ts/logic/war/engine.js';
import { LegacyWarLogFlushSequence } from '@sammo-ts/logic/war/legacyFlushSequence.js';
import type { WarActionModule } from '@sammo-ts/logic/war/actions.js';
import type { NationTraitModule } from '@sammo-ts/logic/actionModules/traits/nation/index.js';
import type { GeneralActionModule } from '@sammo-ts/logic/actionModules/general.js';
import { GeneralActionPipeline } from '@sammo-ts/logic/actionModules/general.js';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';
import type { MapDefinition, UnitSetDefinition } from '@sammo-ts/logic/world/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import { tryApplyUniqueLottery } from '@sammo-ts/logic/rewards/uniqueLottery.js';
import { buildNationFrontStatePatches } from '../../../diplomacy/frontState.js';
import type { TracePort } from '../../../ports/trace.js';
import { formatDestCityConstraintFailure } from '../constraintFailure.js';
import {
    buildWarAftermathConfig,
    buildWarConfig,
    buildWarTime,
} from '@sammo-ts/logic/actions/turn/actionContextHelpers.js';
import { parseArgsWithSchema } from '../parseArgs.js';

export interface DispatchResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity: City;
    destNation?: Nation | null;
    cities: City[];
    nations: Nation[];
    generals: General<TriggerState>[];
    unitSet: UnitSetDefinition;
    map?: MapDefinition;
    diplomacy?: Array<{ fromNationId: number; toNationId: number; state: number; term: number }>;
    time: WarTimeContext;
    seedBase: string;
    warConfig: WarEngineConfig;
    aftermathConfig: WarAftermathConfig;
    messageTime: Date;
    messageSharedIconBaseUrl?: string;
}

export const orderDefenderGenerals = <TriggerState extends GeneralTriggerState>(
    generals: General<TriggerState>[]
): General<TriggerState>[] => [...generals].sort((left, right) => left.id - right.id);

const ACTION_NAME = '출병';
const LEGACY_SORTIE_FLUSH_GROUP_START = Number.MIN_SAFE_INTEGER;
const ARGS_SCHEMA = z.object({
    destCityId: z.number(),
});
export type DispatchArgs = z.infer<typeof ARGS_SCHEMA>;

const parseCityId = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return null;
    }
    return raw > 0 ? Math.floor(raw) : null;
};

const toHex = (bytes: Uint8Array): string =>
    Array.from(bytes)
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');

const fixtureNumber = (value: unknown, fallback = 0): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const formatFixtureDate = (value: Date | undefined): string =>
    value
        ? value
              .toISOString()
              .replace('T', ' ')
              .replace(/\.\d{3}Z$/u, '')
        : '1970-01-01 00:00:00';

const buildBattleGeneralFixture = <TriggerState extends GeneralTriggerState>(general: General<TriggerState>) => {
    const meta = general.meta;
    const rawInheritBuff = general.triggerState.meta.inheritBuff;
    let inheritBuff: Record<string, number> | number[] | undefined;
    if (Array.isArray(rawInheritBuff) && rawInheritBuff.every((value) => typeof value === 'number')) {
        inheritBuff = rawInheritBuff;
    } else if (typeof rawInheritBuff === 'object' && rawInheritBuff !== null) {
        inheritBuff = Object.fromEntries(
            Object.entries(rawInheritBuff).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
        );
    } else if (typeof rawInheritBuff === 'string') {
        try {
            const parsed: unknown = JSON.parse(rawInheritBuff);
            if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'number')) {
                inheritBuff = parsed;
            } else if (typeof parsed === 'object' && parsed !== null) {
                inheritBuff = Object.fromEntries(
                    Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
                );
            }
        } catch {
            // A malformed comparison-only projection must not affect the battle.
        }
    }
    return {
        no: general.id,
        name: general.name,
        nation: general.nationId,
        city: general.cityId,
        turntime: formatFixtureDate(general.turnTime),
        personal: general.role.personality,
        special: general.role.specialDomestic,
        special2: general.role.specialWar,
        crew: general.crew,
        crewtype: general.crewTypeId,
        atmos: general.atmos,
        train: general.train,
        intel: general.stats.intelligence,
        intel_exp: fixtureNumber(meta.intel_exp),
        book: general.role.items.book,
        strength: general.stats.strength,
        strength_exp: fixtureNumber(meta.strength_exp),
        weapon: general.role.items.weapon,
        injury: general.injury,
        leadership: general.stats.leadership,
        leadership_exp: fixtureNumber(meta.leadership_exp),
        horse: general.role.items.horse,
        item: general.role.items.item,
        explevel: fixtureNumber(meta.explevel),
        experience: general.experience,
        dedication: general.dedication,
        officer_level: general.officerLevel,
        officer_city: fixtureNumber(meta.officer_city ?? meta.officerCity),
        gold: general.gold,
        rice: general.rice,
        dex1: fixtureNumber(meta.dex1),
        dex2: fixtureNumber(meta.dex2),
        dex3: fixtureNumber(meta.dex3),
        dex4: fixtureNumber(meta.dex4),
        dex5: fixtureNumber(meta.dex5),
        defence_train: fixtureNumber(meta.defence_train),
        recent_war: general.recentWarTime ? formatFixtureDate(general.recentWarTime) : null,
        warnum: fixtureNumber(meta.rank_warnum),
        killnum: fixtureNumber(meta.rank_killnum),
        killcrew: fixtureNumber(meta.rank_killcrew),
        ...(inheritBuff ? { inheritBuff } : {}),
    };
};

const buildBattleCityFixture = (city: City) => ({
    city: city.id,
    nation: city.nationId,
    supply: city.supplyState,
    name: city.name,
    pop: city.population,
    agri: city.agriculture,
    comm: city.commerce,
    secu: city.security,
    def: city.defence,
    wall: city.wall,
    trust: fixtureNumber(city.meta.trust),
    level: city.level,
    pop_max: city.populationMax,
    agri_max: city.agricultureMax,
    comm_max: city.commerceMax,
    secu_max: city.securityMax,
    def_max: city.defenceMax,
    wall_max: city.wallMax,
    dead: fixtureNumber(city.meta.dead),
    state: city.state,
    conflict: JSON.stringify(city.conflict ?? {}),
});

const buildBattleNationFixture = (nation: Nation | null) => ({
    type: nation?.typeCode ?? 'None',
    tech: fixtureNumber(nation?.meta.tech),
    level: nation?.level ?? 0,
    capital: nation?.capitalCityId ?? 0,
    nation: nation?.id ?? 0,
    name: nation?.name ?? '재야',
    gold: nation?.gold ?? 0,
    rice: nation?.rice ?? 10000,
    gennum: fixtureNumber(nation?.meta.gennum, 1),
});

const buildAllowedNationIds = (
    attackerNationId: number,
    diplomacy: Array<{ fromNationId: number; toNationId: number; state: number }>
): number[] => {
    const allowed = new Set<number>([attackerNationId, 0]);
    for (const entry of diplomacy) {
        if (entry.fromNationId === attackerNationId && entry.state === 0) {
            allowed.add(entry.toNationId);
        }
    }
    return Array.from(allowed);
};

const buildMapIndex = (map: MapDefinition): Map<number, number[]> => {
    const index = new Map<number, number[]>();
    for (const city of map.cities) {
        index.set(city.id, Array.from(city.connections ?? []));
    }
    return index;
};

const searchDistanceListToDest = (
    fromCityId: number,
    toCityId: number,
    mapIndex: Map<number, number[]>,
    allowedCityIds: Map<number, number>
): Map<number, Array<[number, number]>> => {
    if (!allowedCityIds.has(toCityId)) {
        return new Map();
    }
    const remainFromCities = new Set<number>();
    const fromNeighbors = mapIndex.get(fromCityId) ?? [];
    for (const cityId of fromNeighbors) {
        if (allowedCityIds.has(cityId)) {
            remainFromCities.add(cityId);
        }
    }
    const result = new Map<number, Array<[number, number]>>();
    const queue: Array<[number, number]> = [[toCityId, 0]];
    const visited = new Set<number>();

    while (remainFromCities.size > 0 && queue.length > 0) {
        const next = queue.shift();
        if (!next) {
            continue;
        }
        const [cityId, dist] = next;
        if (visited.has(cityId)) {
            continue;
        }
        visited.add(cityId);
        if (remainFromCities.has(cityId)) {
            remainFromCities.delete(cityId);
            const nationId = allowedCityIds.get(cityId) ?? 0;
            const list = result.get(dist);
            if (list) {
                list.push([cityId, nationId]);
            } else {
                result.set(dist, [[cityId, nationId]]);
            }
        }
        const neighbors = mapIndex.get(cityId) ?? [];
        for (const neighbor of neighbors) {
            if (!allowedCityIds.has(neighbor)) {
                continue;
            }
            if (!visited.has(neighbor)) {
                queue.push([neighbor, dist + 1]);
            }
        }
    }

    return result;
};

const pickCandidateCity = (
    rng: DispatchResolveContext['rng'],
    distanceList: Map<number, Array<[number, number]>>,
    attackerNationId: number
): { cityId: number; isEnemy: boolean; minDist: number } | null => {
    const pickLegacyChoice = <T>(items: T[]): T => {
        const legacyCompatibleRng = rng as typeof rng & {
            nextIntInclusive?: (maxInclusive: number) => number;
        };
        const index = legacyCompatibleRng.nextIntInclusive?.(items.length - 1) ?? rng.nextInt(0, items.length);
        return items[index]!;
    };
    const distances = Array.from(distanceList.keys()).sort((a, b) => a - b);
    const minDist = distances[0];
    if (minDist === undefined) {
        return null;
    }
    for (const dist of distances) {
        if (dist > minDist + 1) {
            break;
        }
        const candidates = (distanceList.get(dist) ?? []).filter(([, nationId]) => nationId !== attackerNationId);
        if (candidates.length > 0) {
            // Ref breaks at the first distance layer containing an enemy. It
            // only considers minDist + 1 when the minDist layer has none.
            // RandUtil::choice() still consumes nextInt(0) for one candidate.
            const [cityId] = pickLegacyChoice(candidates);
            return { cityId, isEnemy: true, minDist };
        }
    }
    const fallback = distanceList.get(minDist) ?? [];
    const friendly = fallback.filter(([, nationId]) => nationId === attackerNationId);
    if (friendly.length === 0) {
        return null;
    }
    const [cityId] = pickLegacyChoice(friendly);
    return { cityId, isEnemy: false, minDist };
};

const getRequiredRice = (ctx: ConstraintContext, view: StateView): number => {
    const general = readGeneral(ctx, view);
    if (!general) {
        return 0;
    }
    return Math.round(general.crew / 100);
};

const resolveCrewTypeArm = (unitSet: UnitSetDefinition, crewTypeId: number): number | null => {
    const crewTypes = unitSet.crewTypes ?? [];
    const crewType = crewTypes.find((entry) => entry.id === crewTypeId);
    if (!crewType) {
        return null;
    }
    return crewType.armType;
};

const cloneGeneral = <TriggerState extends GeneralTriggerState>(
    general: General<TriggerState>
): General<TriggerState> => ({
    ...general,
    stats: { ...general.stats },
    role: {
        ...general.role,
        items: {
            ...general.role.items,
        },
    },
    triggerState: {
        ...general.triggerState,
        flags: { ...general.triggerState.flags },
        counters: { ...general.triggerState.counters },
        modifiers: { ...general.triggerState.modifiers },
        meta: { ...general.triggerState.meta },
    },
    meta: { ...general.meta },
});

const cloneCity = (city: City): City => ({
    ...city,
    meta: { ...city.meta },
});

const cloneNation = (nation: Nation): Nation => ({
    ...nation,
    meta: { ...nation.meta },
});

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, DispatchArgs, DispatchResolveContext<TriggerState>> {
    public readonly key = 'che_출병';
    public readonly name = ACTION_NAME;
    getInheritanceActiveActionAmount(): number {
        return 1;
    }
    private readonly warModules: ReadonlyArray<WarActionModule<TriggerState>>;
    private readonly nationTraitModules: Map<string, NationTraitModule>;
    private readonly generalModules: ReadonlyArray<GeneralActionModule<TriggerState>>;
    private readonly generalPipeline: GeneralActionPipeline<TriggerState>;

    constructor(
        modules: ReadonlyArray<WarActionModule<TriggerState> | null | undefined> = [],
        nationTraitModules: NationTraitModule[] = [],
        generalModules: ReadonlyArray<GeneralActionModule<TriggerState> | null | undefined> = [],
        private readonly trace?: TracePort
    ) {
        this.warModules = modules.filter(Boolean) as ReadonlyArray<WarActionModule<TriggerState>>;
        this.nationTraitModules = new Map(nationTraitModules.map((module) => [module.key, module]));
        this.generalModules = generalModules.filter(Boolean) as ReadonlyArray<GeneralActionModule<TriggerState>>;
        this.generalPipeline = new GeneralActionPipeline(this.generalModules);
    }

    parseArgs(raw: unknown): DispatchArgs | null {
        const data = parseArgsWithSchema(ARGS_SCHEMA, raw);
        if (!data) {
            return null;
        }
        const destCityId = parseCityId(data.destCityId);
        if (destCityId === null) {
            return null;
        }
        return { destCityId };
    }

    buildMinConstraints(ctx: ConstraintContext, _args: DispatchArgs): Constraint[] {
        const relYear = typeof ctx.env.relYear === 'number' ? ctx.env.relYear : 0;
        const openingPartYear = typeof ctx.env.openingPartYear === 'number' ? ctx.env.openingPartYear : 0;
        return [
            notOpeningPart(relYear + 2, openingPartYear),
            notBeNeutral(),
            occupiedCity(),
            reqGeneralCrew(),
            reqGeneralRice(getRequiredRice),
        ];
    }

    buildConstraints(_ctx: ConstraintContext, _args: DispatchArgs): Constraint[] {
        const relYear = typeof _ctx.env.relYear === 'number' ? _ctx.env.relYear : 0;
        const openingPartYear = typeof _ctx.env.openingPartYear === 'number' ? _ctx.env.openingPartYear : 0;
        return [
            notOpeningPart(relYear, openingPartYear),
            notSameDestCity(),
            notBeNeutral(),
            occupiedCity(),
            reqGeneralCrew(),
            reqGeneralRice(getRequiredRice),
            allowWar(),
            hasRouteWithEnemy(),
        ];
    }

    formatConstraintFailure(
        reason: string,
        _ctx: ConstraintContext,
        args: DispatchArgs,
        view: StateView
    ): string | null {
        return formatDestCityConstraintFailure(reason, this.name, args.destCityId, view, 'direction');
    }

    resolve(context: DispatchResolveContext<TriggerState>, args: DispatchArgs): GeneralActionOutcome<TriggerState> {
        void args;
        const attackerCity = context.city;
        if (!attackerCity) {
            throw new Error('Dispatch requires a city context.');
        }
        const attackerNation = context.nation;
        if (!attackerNation) {
            throw new Error('Dispatch requires a nation context.');
        }

        const finalTargetCity = context.destCity;
        const unitSet = context.unitSet;
        const time = context.time;
        const diplomacy = context.diplomacy ?? [];
        const allowedNationIds = buildAllowedNationIds(attackerNation.id, diplomacy);
        const mapIndex = context.map ? buildMapIndex(context.map) : null;

        let defenderCityId = finalTargetCity.id;
        let minDist = 0;
        let isEnemyTarget = finalTargetCity.nationId !== attackerNation.id;

        if (mapIndex) {
            const allowedCityIds = new Map<number, number>();
            for (const city of context.cities) {
                if (allowedNationIds.includes(city.nationId)) {
                    allowedCityIds.set(city.id, city.nationId);
                }
            }
            const distanceList = searchDistanceListToDest(
                attackerCity.id,
                finalTargetCity.id,
                mapIndex,
                allowedCityIds
            );
            const picked = pickCandidateCity(context.rng, distanceList, attackerNation.id);
            if (!picked) {
                context.addLog('경로에 도달할 방법이 없습니다.');
                return { effects: [] };
            }
            defenderCityId = picked.cityId;
            minDist = picked.minDist;
            isEnemyTarget = picked.isEnemy;
        }

        const destCity =
            defenderCityId === finalTargetCity.id
                ? finalTargetCity
                : (context.cities.find((city) => city.id === defenderCityId) ?? finalTargetCity);

        if (!isEnemyTarget && destCity.nationId === attackerNation.id) {
            const josaRo = JosaUtil.pick(destCity.name, '로');
            if (finalTargetCity.id === destCity.id) {
                context.addLog(`본국입니다. <G><b>${destCity.name}</b></>${josaRo} 이동합니다.`);
            } else {
                const targetName = finalTargetCity.name;
                const josaRoTarget = JosaUtil.pick(targetName, '로');
                const josaUl = JosaUtil.pick(destCity.name, '을');
                context.addLog(
                    `가까운 경로에 적군 도시가 없습니다. <G><b>${destCity.name}</b></>${josaRo} 이동합니다.`
                );
                context.addLog(
                    `<G><b>${targetName}</b></>${josaRoTarget} 가는 도중 <G><b>${destCity.name}</b></>${josaUl} 거치기로 합니다.`
                );
            }
            return {
                effects: [],
                alternative: {
                    commandKey: 'che_이동',
                    args: { destCityId: destCity.id },
                },
            };
        }

        // Ref che_출병은 명령 내부에서도 General::applyDB()/ActionLogger::flush()를
        // 여러 번 수행한다. 외부 TurnExecutionHelper progression(group 0)과
        // 섞이지 않도록 명령 내부 epoch은 작은 음수부터 단조 증가시킨다.
        const legacyFlushSequence = new LegacyWarLogFlushSequence(LEGACY_SORTIE_FLUSH_GROUP_START);
        const preWarFlushGroup = legacyFlushSequence.claimGroup()!;

        if (finalTargetCity.id !== destCity.id) {
            const josaRo = JosaUtil.pick(finalTargetCity.name, '로');
            const josaUl = JosaUtil.pick(destCity.name, '을');
            if (minDist === 0) {
                context.addLog(
                    `<G><b>${finalTargetCity.name}</b></>${josaRo} 가기 위해 <G><b>${destCity.name}</b></>${josaUl} 거쳐야 합니다.`,
                    { legacyFlushGroup: preWarFlushGroup }
                );
            } else {
                context.addLog(
                    `<G><b>${finalTargetCity.name}</b></>${josaRo} 가는 도중 <G><b>${destCity.name}</b></>${josaUl} 거치기로 합니다.`,
                    { legacyFlushGroup: preWarFlushGroup }
                );
            }
        }

        const preSeed = simpleSerialize(
            context.seedBase,
            'war',
            time.year,
            time.month,
            context.general.id,
            destCity.id
        );
        const seed = toHex(LiteHashDRBG.build(preSeed).nextBytes(16));

        const armType = resolveCrewTypeArm(unitSet, context.general.crewTypeId);
        if (armType !== null) {
            const typeMultiplier = armType === 4 || armType === 5 ? 0.9 : 1;
            const amount = this.generalPipeline.onCalcStat(
                context,
                'addDex',
                (context.general.crew / 100) * typeMultiplier,
                { armType }
            );
            const dexKey = `dex${armType}`;
            const currentDex = context.general.meta[dexKey];
            context.general.meta[dexKey] = (typeof currentDex === 'number' ? currentDex : 0) + amount;
        }

        const cities = context.cities.map(cloneCity);
        const nations = context.nations.map(cloneNation);
        const generals = context.generals.map(cloneGeneral);

        const cityMap = new Map(cities.map((city) => [city.id, city]));
        const nationMap = new Map(nations.map((nation) => [nation.id, nation]));

        const defenderCity = cityMap.get(destCity.id) ?? cloneCity(destCity);
        // Legacy marks the destination as an active battle for three turns
        // before processWar(), including when the attack immediately conquers
        // the city. ConquerCity resets term but intentionally leaves state 43.
        defenderCity.state = 43;
        defenderCity.meta.term = 3;
        const defenderNation = defenderCity.nationId > 0 ? (nationMap.get(defenderCity.nationId) ?? null) : null;

        const defenderGenerals = orderDefenderGenerals(
            generals.filter(
                (general) =>
                    general.cityId === defenderCity.id &&
                    general.nationId === defenderCity.nationId &&
                    general.crew > 0 &&
                    (unitSet.crewTypes?.some((crewType) => crewType.id === general.crewTypeId) ?? false)
            )
        );
        const battleGeneralIds = [context.general.id, ...defenderGenerals.map((general) => general.id)];
        const shouldTraceWar = this.trace?.isEnabled('AI_WAR_TRACE', { generalIds: battleGeneralIds }) ?? false;

        if (this.trace?.isEnabled('AI_WAR_FIXTURE_CORE', { generalIds: battleGeneralIds })) {
            this.trace.write('AI_WAR_FIXTURE_CORE', {
                action: 'battle',
                seed,
                repeatCnt: 1,
                year: time.year,
                month: time.month,
                startYear: time.startYear,
                scenarioEffect: null,
                attackerGeneral: buildBattleGeneralFixture(context.general),
                attackerCity: buildBattleCityFixture(attackerCity),
                attackerNation: buildBattleNationFixture(attackerNation),
                defenderGenerals: defenderGenerals.map(buildBattleGeneralFixture),
                defenderCity: buildBattleCityFixture(defenderCity),
                defenderNation: buildBattleNationFixture(defenderNation),
            });
        }

        const battle = resolveWarBattle({
            seed,
            unitSet,
            config: context.warConfig,
            time,
            attacker: {
                general: context.general,
                city: attackerCity,
                nation: attackerNation,
                modules: this.warModules,
            },
            defenders: defenderGenerals.map((general) => ({
                general,
                city: defenderCity,
                nation: defenderNation,
                modules: this.warModules,
            })),
            defenderCity,
            defenderNation,
            legacyFlushSequence,
            ...(shouldTraceWar
                ? {
                      trace: (event) => {
                          this.trace?.write('AI_WAR_TRACE', { generalId: context.general.id, event });
                      },
                  }
                : {}),
        });

        const aftermath = resolveWarAftermath({
            battle,
            attackerNation,
            defenderNation,
            attackerCity,
            defenderCity,
            nations,
            cities,
            generals,
            unitSet,
            config: context.aftermathConfig,
            time,
            messageTime: context.messageTime,
            hiddenSeed: context.seedBase,
            legacyFlushSequence,
            generalActionModules: this.generalModules,
            calcNationTechGain: ({ nation, baseGain }) => {
                const module = this.nationTraitModules.get(nation.typeCode);
                return (
                    module?.onCalcDomestic?.({ general: context.general, nation }, '기술', 'score', baseGain) ??
                    baseGain
                );
            },
            ...(context.messageSharedIconBaseUrl ? { messageSharedIconBaseUrl: context.messageSharedIconBaseUrl } : {}),
            ...(this.trace ? { trace: this.trace } : {}),
        });

        // Ref ConquerCity() recalculates the fronts of every nation around the
        // captured city immediately. Later generals in the same monthly due
        // list therefore observe those refreshed values when choosing whether
        // to deploy. Preserve that ordering before snapshotting city effects.
        let frontStatePatches: Array<{ id: number; frontState: number }> = [];
        if (battle.conquered && context.map && context.diplomacy) {
            const connections = new Map(context.map.cities.map((city) => [city.id, city.connections ?? []] as const));
            const nearbyCityIds = new Set([defenderCity.id, ...(connections.get(defenderCity.id) ?? [])]);
            const nearbyNationIds = new Set<number>([aftermath.conquest?.conquerNationId ?? attackerNation.id]);
            for (const city of cities) {
                if (nearbyCityIds.has(city.id) && city.nationId > 0) {
                    nearbyNationIds.add(city.nationId);
                }
            }
            frontStatePatches = buildNationFrontStatePatches({
                cities,
                diplomacy: context.diplomacy,
                connections,
                nationIds: [...nearbyNationIds],
            });
            for (const patch of frontStatePatches) {
                const city = cities.find((candidate) => candidate.id === patch.id);
                if (city) {
                    city.frontState = patch.frontState;
                }
            }
        }

        const effects: Array<GeneralActionEffect<TriggerState>> = [];
        // processWar() 반환 후 StaticEvent/unique 로직이 끝나면 Ref line 259의
        // actor applyDB가 실행된다. 이 epoch은 command 반환 후 outer progression과 별개다.
        const finalActorFlushGroup = legacyFlushSequence.claimGroup()!;

        for (const entry of battle.logs) {
            effects.push({ type: 'log', entry });
        }
        for (const entry of aftermath.logs) {
            effects.push({
                type: 'log',
                entry:
                    entry.legacyFlushGroup === undefined ? { ...entry, legacyFlushGroup: finalActorFlushGroup } : entry,
            });
        }
        for (const message of aftermath.conquest?.messages ?? []) {
            effects.push(createMessageEffect(message));
        }

        const generalPatches = new Map<number, General<TriggerState>>();
        const cityPatches = new Map<number, City>();
        const nationPatches = new Map<number, Nation>();

        const addGeneralPatch = (general: General<TriggerState>): void => {
            if (general.id === context.general.id) {
                return;
            }
            generalPatches.set(general.id, cloneGeneral(general));
        };
        const addCityPatch = (city: City): void => {
            if (context.city && city.id === context.city.id) {
                return;
            }
            cityPatches.set(city.id, cloneCity(city));
        };
        const addNationPatch = (nation: Nation): void => {
            if (context.nation && nation.id === context.nation.id) {
                return;
            }
            nationPatches.set(nation.id, cloneNation(nation));
        };

        for (const defender of battle.defenders) {
            addGeneralPatch(defender);
        }
        for (const general of aftermath.generals) {
            addGeneralPatch(general);
        }
        addCityPatch(defenderCity);
        for (const city of aftermath.cities) {
            addCityPatch(city);
        }
        if (defenderNation) {
            addNationPatch(defenderNation);
        }
        for (const nation of aftermath.nations) {
            addNationPatch(nation);
        }

        for (const [id, patch] of generalPatches) {
            effects.push(createGeneralPatchEffect(patch, id));
        }
        for (const [id, patch] of cityPatches) {
            effects.push(createCityPatchEffect(patch, id));
        }
        for (const patch of frontStatePatches) {
            effects.push(createCityPatchEffect({ frontState: patch.frontState }, patch.id));
        }
        for (const [id, patch] of nationPatches) {
            effects.push(createNationPatchEffect(patch, id));
        }

        for (const delta of aftermath.diplomacyDeltas) {
            effects.push(
                createDiplomacyPatchEffect(delta.fromNationId, delta.toNationId, {
                    deadDelta: delta.deadDelta,
                })
            );
        }

        const addFinalActorLog: NonNullable<typeof context.addPostProgressionLog> = (message, options = {}) => {
            const sink = context.addPostProgressionLog ?? context.addLog;
            sink(message, {
                ...options,
                legacyFlushGroup: finalActorFlushGroup,
            });
        };
        tryApplyUniqueLottery(
            {
                ...context,
                addPostProgressionLog: addFinalActorLog,
            },
            { acquireType: '아이템', reason: ACTION_NAME }
        );

        return {
            effects,
            ...(aftermath.conquest?.nationCollapsed && defenderNation
                ? { destroyedNationIds: [defenderNation.id] }
                : {}),
            ...(aftermath.conquest?.ruinedNpcJoinPlans.length
                ? { reservedGeneralTurnPlans: aftermath.conquest.ruinedNpcJoinPlans }
                : {}),
        };
    }
}

// 예약 턴 실행에 필요한 전투 컨텍스트를 구성한다.
export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    if (!options.unitSet || !options.worldRef) {
        return null;
    }
    const destCityId = options.actionArgs.destCityId;
    if (typeof destCityId !== 'number') {
        return null;
    }
    const destCity = options.worldRef.getCityById(destCityId);
    if (!destCity) {
        return null;
    }
    const destNation = destCity.nationId > 0 ? options.worldRef.getNationById(destCity.nationId) : null;
    const diplomacy = options.worldRef.listDiplomacy();
    const warConfig = buildWarConfig(options.scenarioConfig, options.unitSet);
    const aftermathConfig = buildWarAftermathConfig(options.scenarioConfig, warConfig.castleCrewTypeId);
    const joinModeRaw = options.world.meta?.join_mode ?? options.world.meta?.joinMode;
    aftermathConfig.joinMode = joinModeRaw === 'onlyRandom' ? 'onlyRandom' : 'full';
    return {
        ...base,
        destCity,
        destNation,
        cities: options.worldRef.listCities(),
        nations: options.worldRef.listNations(),
        generals: options.worldRef.listGenerals(),
        unitSet: options.unitSet,
        map: options.map,
        diplomacy,
        time: buildWarTime(options.world, options.scenarioMeta),
        seedBase: options.seedBase,
        warConfig,
        aftermathConfig,
        messageTime: options.gameNow ?? base.general.turnTime,
        ...(options.messageSharedIconBaseUrl ? { messageSharedIconBaseUrl: options.messageSharedIconBaseUrl } : {}),
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_출병',
    category: '군사',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) =>
        new ActionDefinition(
            env.warActionModules ?? [],
            env.nationTraitModules ?? [],
            env.generalActionModules ?? [],
            env.trace
        ),
};
