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
import { parseArgsWithSchema } from '../parseArgs.js';

const ARGS_SCHEMA = z.object({
    destCityID: z.number(),
});
export type MoveCapitalArgs = z.infer<typeof ARGS_SCHEMA>;

export interface MoveCapitalResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity: City;
    map: MapDefinition;
}

const ACTION_NAME = '천도';

const hasRouteToDestCity = (destCityID: number, develCost: number): Constraint => ({
    name: 'hasRouteToDestCity',
    requires: (ctx) => [{ kind: 'nation', id: ctx.nationId! }, { kind: 'env', key: 'map' }],
    test: (ctx: ConstraintContext, view: StateView) => {
        const nation = view.get({ kind: 'nation', id: ctx.nationId! }) as Nation | undefined;
        const map = view.get({ kind: 'env', key: 'map' }) as MapDefinition | undefined;
        if (!nation || !map || nation.capitalCityId === undefined || nation.capitalCityId === null) {
            return { kind: 'allow' };
        }
        const dist = calcDistance(nation.capitalCityId, destCityID, map);
        if (dist >= 50) {
            return { kind: 'deny', reason: '천도 대상으로 도달할 방법이 없습니다.' };
        }
        const cost = develCost * 5 * Math.pow(2, dist);
        if (nation.gold < cost + 1000) {
            return { kind: 'allow' };
        }
        if (nation.rice < cost + 1000) {
            return { kind: 'allow' };
        }
        return { kind: 'allow' };
    },
});

const calcDistance = (fromCityId: number, toCityId: number, map: MapDefinition): number => {
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
            if (!visited.has(next)) {
                visited.add(next);
                queue.push([next, dist + 1]);
            }
        }
    }

    return 50;
};

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, MoveCapitalArgs, MoveCapitalResolveContext<TriggerState>> {
    public readonly key = 'che_천도';
    public readonly name = ACTION_NAME;

    constructor(private readonly env: TurnCommandEnv) {}

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
            const dist = calcDistance(nation.capitalCityId, args.destCityID, map);
            if (dist >= 50) {
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
            hasRouteToDestCity(args.destCityID, develcost),
            reqNationValue('capitalCityId', '수도', '!=', args.destCityID, '이미 수도입니다.'),
            reqNationGold((ctx, view) => baseGold + getRequiredCost(ctx, view), [{ kind: 'env', key: 'map' }]),
            reqNationRice((ctx, view) => baseRice + getRequiredCost(ctx, view), [{ kind: 'env', key: 'map' }]),
        ];
    }

    resolve(
        context: MoveCapitalResolveContext<TriggerState>,
        args: MoveCapitalArgs
    ): GeneralActionOutcome<TriggerState> {
        const { general, nation, destCity, map } = context;
        if (!nation || nation.capitalCityId === undefined || nation.capitalCityId === null) {
            return { effects: [createLogEffect('국가 정보가 없습니다.', { scope: LogScope.GENERAL })] };
        }

        const dist = calcDistance(nation.capitalCityId, args.destCityID, map);
        const cost = this.env.develCost * 5 * Math.pow(2, dist);

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
                    gold: nation.gold - cost,
                    rice: nation.rice - cost,
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
            // General Action Log
            createLogEffect(`<G><b>${destCityName}</b></>${josaRo} ${ACTION_NAME}했습니다.`, {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.MONTH,
            }),
        ];

        general.experience += 5 * (dist * 2 + 1);
        general.dedication += 5 * (dist * 2 + 1);

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
