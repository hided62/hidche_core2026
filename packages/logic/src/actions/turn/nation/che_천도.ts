import type { City, GeneralTriggerState, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, StateView } from '@sammo-ts/logic/constraints/types.js';
import {
    beChief,
    occupiedCity,
    occupiedDestCity,
    reqNationGold,
    reqNationRice,
    reqNationValue,
    suppliedCity,
    suppliedDestCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionEffect,
    GeneralActionOutcome,
    GeneralActionResolveContext,
} from '@sammo-ts/logic/actions/engine.js';
import { createLogEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import { JosaUtil } from '@sammo-ts/common';
import type { NationTurnCommandSpec } from './index.js';
import type { MapDefinition } from '@sammo-ts/logic/world/types.js';
import { z } from 'zod';
import { normalizeLegacyIntegerArg, parseArgsWithSchema } from '../parseArgs.js';
import { GeneralActionPipeline } from '@sammo-ts/logic/actionModules/general.js';

const ARGS_SCHEMA = z.object({
    destCityID: z.preprocess(normalizeLegacyIntegerArg, z.number()),
});
export type MoveCapitalArgs = z.infer<typeof ARGS_SCHEMA>;

export interface MoveCapitalResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity: City;
    map: MapDefinition;
    nationCities: City[];
}

const ACTION_NAME = '천도';

const hasRouteToDestCity = (destCityID: number): Constraint => ({
    name: 'hasRouteToDestCity',
    requires: (ctx) => [
        { kind: 'nation', id: ctx.nationId! },
        { kind: 'env', key: 'map' },
        { kind: 'env', key: 'cities' },
    ],
    test: (ctx: ConstraintContext, view: StateView) => {
        const nation = view.get({ kind: 'nation', id: ctx.nationId! }) as Nation | undefined;
        const map = view.get({ kind: 'env', key: 'map' }) as MapDefinition | undefined;
        const cities = view.get({ kind: 'env', key: 'cities' }) as City[] | undefined;
        if (!nation || !map || nation.capitalCityId === undefined || nation.capitalCityId === null) {
            return { kind: 'allow' };
        }
        const allowedCityIds = new Set(
            (cities ?? []).filter((city) => city.nationId === nation.id).map((city) => city.id)
        );
        const dist = calcDistance(nation.capitalCityId, destCityID, map, allowedCityIds);
        if (dist === null) {
            return { kind: 'deny', reason: '천도 대상으로 도달할 방법이 없습니다.' };
        }
        return { kind: 'allow' };
    },
});

const calcDistance = (
    fromCityId: number,
    toCityId: number,
    map: MapDefinition,
    allowedCityIds?: ReadonlySet<number>
): number | null => {
    if (allowedCityIds && !allowedCityIds.has(toCityId)) return null;
    if (fromCityId === toCityId) return 0;

    const connections = new Map<number, number[]>();

    for (const city of map.cities) {
        connections.set(city.id, city.connections ?? []);
    }

    const queue: Array<[number, number]> = [[fromCityId, 0]];
    const visited = new Set<number>([fromCityId]);

    while (queue.length > 0) {
        const [current, dist] = queue.shift()!;
        if (current === toCityId) return dist;

        const nextNodes = connections.get(current) ?? [];
        for (const next of nextNodes) {
            if (allowedCityIds && !allowedCityIds.has(next)) {
                continue;
            }
            if (!visited.has(next)) {
                visited.add(next);
                queue.push([next, dist + 1]);
            }
        }
    }

    return null;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, MoveCapitalArgs, MoveCapitalResolveContext<TriggerState>> {
    public readonly key = 'che_천도';
    public readonly name = ACTION_NAME;
    public readonly countsAsInheritanceActiveAction = true;
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(private readonly env: TurnCommandEnv) {
        this.pipeline = new GeneralActionPipeline(env.generalActionModules ?? []);
    }

    parseArgs(raw: unknown): MoveCapitalArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(_ctx: ConstraintContext, _args: MoveCapitalArgs): Constraint[] {
        return [occupiedCity(), beChief(), suppliedCity()];
    }

    buildConstraints(_ctx: ConstraintContext, args: MoveCapitalArgs): Constraint[] {
        const develcost = this.env.develCost;
        const baseGold = this.env.baseGold ?? 1000;
        const baseRice = this.env.baseRice ?? 1000;

        const getRequiredCost = (ctx: ConstraintContext, view: StateView): number => {
            const nation = view.get({ kind: 'nation', id: ctx.nationId! }) as Nation | undefined;
            const map = view.get({ kind: 'env', key: 'map' }) as MapDefinition | undefined;
            if (!nation || !map || nation.capitalCityId === undefined || nation.capitalCityId === null) {
                return 0;
            }
            const cities = view.get({ kind: 'env', key: 'cities' }) as City[] | undefined;
            const allowedCityIds = new Set(
                (cities ?? []).filter((city) => city.nationId === nation.id).map((city) => city.id)
            );
            const dist = calcDistance(nation.capitalCityId, args.destCityID, map, allowedCityIds);
            if (dist === null) {
                return 0;
            }
            return develcost * 5 * Math.pow(2, dist);
        };

        return [
            occupiedCity(),
            occupiedDestCity(),
            beChief(),
            suppliedCity(),
            suppliedDestCity(),
            hasRouteToDestCity(args.destCityID),
            reqNationValue('capitalCityId', '수도', '!=', args.destCityID, '이미 수도입니다.'),
            reqNationGold(
                (ctx, view) => baseGold + getRequiredCost(ctx, view),
                [
                    { kind: 'env', key: 'map' },
                    { kind: 'env', key: 'cities' },
                ]
            ),
            reqNationRice(
                (ctx, view) => baseRice + getRequiredCost(ctx, view),
                [
                    { kind: 'env', key: 'map' },
                    { kind: 'env', key: 'cities' },
                ]
            ),
        ];
    }

    getPreReqTurn(context: MoveCapitalResolveContext<TriggerState>, args: MoveCapitalArgs): number {
        if (!context.nation?.capitalCityId) {
            return 0;
        }
        const allowedCityIds = new Set(context.nationCities.map((city) => city.id));
        return (calcDistance(context.nation.capitalCityId, args.destCityID, context.map, allowedCityIds) ?? 0) * 2;
    }

    getStackSequence(context: MoveCapitalResolveContext<TriggerState>): number {
        const value = context.nation?.meta.capset;
        return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
    }

    resolve(
        context: MoveCapitalResolveContext<TriggerState>,
        args: MoveCapitalArgs
    ): GeneralActionOutcome<TriggerState> {
        const { general, nation, destCity, map } = context;
        if (!nation || nation.capitalCityId === undefined || nation.capitalCityId === null) {
            return { effects: [createLogEffect('국가 정보가 없습니다.', { scope: LogScope.GENERAL })] };
        }

        const nationCities = context.nationCities ?? [];
        const allowedCityIds = nationCities.length > 0 ? new Set(nationCities.map((city) => city.id)) : undefined;
        const dist = calcDistance(nation.capitalCityId, args.destCityID, map, allowedCityIds);
        if (dist === null) {
            return { effects: [createLogEffect('천도 대상으로 도달할 방법이 없습니다.', { scope: LogScope.GENERAL })] };
        }
        const generalName = general.name;
        const nationName = nation.name;
        const destCityName = destCity.name;

        const josaRo = JosaUtil.pick(destCityName, '로');
        const josaYi = JosaUtil.pick(generalName, '이');
        const josaYiNation = JosaUtil.pick(nationName, '이');

        const effects: Array<GeneralActionEffect<TriggerState>> = [
            createNationPatchEffect(
                {
                    capitalCityId: args.destCityID,
                    // ref는 비용 보유를 제약에서 검사하지만 실행 시 차감하지 않는다.
                    meta: {
                        ...nation.meta,
                        capset: (typeof nation.meta.capset === 'number' ? nation.meta.capset : 0) + 1,
                    },
                },
                nation.id
            ),
            // Global Action Log
            createLogEffect(
                `<Y>${generalName}</>${josaYi} <G><b>${destCityName}</b></>${josaRo} <M>${ACTION_NAME}</>를 명령하였습니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.ACTION,
                    format: LogFormat.PLAIN,
                }
            ),
            // Global History Log
            createLogEffect(
                `<S><b>【${ACTION_NAME}】</b></><D><b>${nationName}</b></>${josaYiNation} <G><b>${destCityName}</b></>${josaRo} <M>${ACTION_NAME}</>하였습니다.`,
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            // Actor Nation History Log
            createLogEffect(
                `<Y>${generalName}</>${josaYi} <G><b>${destCityName}</b></>${josaRo} <M>${ACTION_NAME}</> 명령`,
                {
                    scope: LogScope.NATION,
                    nationId: nation.id,
                    category: LogCategory.HISTORY,
                    format: LogFormat.YEAR_MONTH,
                }
            ),
            createLogEffect(`<G><b>${destCityName}</b></>${josaRo} <M>${ACTION_NAME}</>명령`, {
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }),
            // General Action Log
            createLogEffect(`<G><b>${destCityName}</b></>${josaRo} ${ACTION_NAME}했습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            }),
        ];

        const reward = 5 * (dist * 2 + 1);
        general.experience += this.pipeline.onCalcStat(context, 'experience', reward);
        general.dedication += this.pipeline.onCalcStat(context, 'dedication', reward);

        return { effects };
    }
}

export const actionContextBuilder: ActionContextBuilder<MoveCapitalArgs> = (base, options) => {
    const destCityId = options.actionArgs.destCityID;
    if (typeof destCityId !== 'number') return null;

    const worldRef = options.worldRef;
    if (!worldRef) return null;

    const destCity = worldRef.getCityById(destCityId);
    const map = options.map;
    if (!destCity || !map) return null;

    return {
        ...base,
        destCity,
        map,
        nationCities: worldRef.listCities().filter((city) => city.nationId === base.general.nationId),
    };
};

export const commandSpec: NationTurnCommandSpec = {
    key: 'che_천도',
    category: '국가',
    reqArg: true,
    availabilityArgs: { destCityID: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
