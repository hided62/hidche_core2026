import type { City, General, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    existsDestCity,
    hasRouteWithEnemy,
    notBeNeutral,
    notOccupiedDestCity,
    notOpeningPart,
    notSameDestCity,
    occupiedCity,
    reqGeneralCrew,
    reqGeneralRice,
    suppliedCity,
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
    createNationPatchEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { JosaUtil, LiteHashDRBG } from '@sammo-ts/common';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type { WarAftermathConfig, WarEngineConfig, WarTimeContext } from '@sammo-ts/logic/war/types.js';
import { resolveWarAftermath } from '@sammo-ts/logic/war/aftermath.js';
import { resolveWarBattle } from '@sammo-ts/logic/war/engine.js';
import type { WarActionModule } from '@sammo-ts/logic/war/actions.js';
import { increaseMetaNumber, simpleSerialize } from '@sammo-ts/logic/war/utils.js';
import type { MapDefinition, UnitSetDefinition } from '@sammo-ts/logic/world/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
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
    diplomacy?: Array<{ fromNationId: number; toNationId: number; state: number }>;
    time: WarTimeContext;
    seedBase: string;
    warConfig: WarEngineConfig;
    aftermathConfig: WarAftermathConfig;
}

const ACTION_NAME = '출병';
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
    const distances = Array.from(distanceList.keys()).sort((a, b) => a - b);
    const minDist = distances[0];
    if (minDist === undefined) {
        return null;
    }
    const candidates: Array<[number, number]> = [];
    for (const dist of distances) {
        if (dist > minDist + 1) {
            break;
        }
        for (const entry of distanceList.get(dist) ?? []) {
            if (entry[1] !== attackerNationId) {
                candidates.push(entry);
            }
        }
    }
    if (candidates.length > 0) {
        const index = rng.nextInt(0, candidates.length);
        const [cityId] = candidates[index] ?? candidates[0]!;
        return { cityId, isEnemy: true, minDist };
    }
    const fallback = distanceList.get(minDist) ?? [];
    const friendly = fallback.filter(([, nationId]) => nationId === attackerNationId);
    if (friendly.length === 0) {
        return null;
    }
    const index = rng.nextInt(0, friendly.length);
    const [cityId] = friendly[index] ?? friendly[0]!;
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
    private readonly warModules: Array<WarActionModule<TriggerState>>;

    constructor(modules: Array<WarActionModule<TriggerState> | null | undefined> = []) {
        this.warModules = modules.filter(Boolean) as Array<WarActionModule<TriggerState>>;
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
            suppliedCity(),
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
            suppliedCity(),
            reqGeneralCrew(),
            reqGeneralRice(getRequiredRice),
            existsDestCity(),
            notOccupiedDestCity(),
            hasRouteWithEnemy(),
        ];
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
                context.addLog(
                    `가까운 경로에 적군 도시가 없습니다. <G><b>${destCity.name}</b></>${josaRo} 이동합니다.`
                );
                context.addLog(
                    `<G><b>${targetName}</b></>${josaRoTarget} 가는 도중 <G><b>${destCity.name}</b></>을 거치기로 합니다.`
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

        if (finalTargetCity.id !== destCity.id) {
            const josaRo = JosaUtil.pick(finalTargetCity.name, '로');
            const josaUl = JosaUtil.pick(destCity.name, '을');
            if (minDist === 0) {
                context.addLog(
                    `<G><b>${finalTargetCity.name}</b></>${josaRo} 가기 위해 <G><b>${destCity.name}</b></>${josaUl} 거쳐야 합니다.`
                );
            } else {
                context.addLog(
                    `<G><b>${finalTargetCity.name}</b></>${josaRo} 가는 도중 <G><b>${destCity.name}</b></>${josaUl} 거치기로 합니다.`
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
            increaseMetaNumber(context.general.meta, `dex${armType}`, context.general.crew / 100);
        }

        const cities = context.cities.map(cloneCity);
        const nations = context.nations.map(cloneNation);
        const generals = context.generals.map(cloneGeneral);

        const cityMap = new Map(cities.map((city) => [city.id, city]));
        const nationMap = new Map(nations.map((nation) => [nation.id, nation]));

        const defenderCity = cityMap.get(destCity.id) ?? cloneCity(destCity);
        const defenderNation = defenderCity.nationId > 0 ? (nationMap.get(defenderCity.nationId) ?? null) : null;

        const defenderGenerals = generals.filter(
            (general) => general.cityId === defenderCity.id && general.nationId === defenderCity.nationId
        );

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
            hiddenSeed: context.seedBase,
        });

        const effects: Array<GeneralActionEffect<TriggerState>> = [];

        for (const entry of battle.logs) {
            effects.push({ type: 'log', entry });
        }
        for (const entry of aftermath.logs) {
            effects.push({ type: 'log', entry });
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

        return { effects };
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
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_출병',
    category: '군사',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env.warActionModules ?? []),
};
