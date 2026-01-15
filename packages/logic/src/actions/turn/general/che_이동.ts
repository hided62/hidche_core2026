import type { General, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext, RequirementKey } from '@sammo-ts/logic/constraints/types.js';
import {
    notSameDestCity,
    existsDestCity,
    reqGeneralGold,
    unknownOrDeny,
    resolveDestCityId,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
    GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import { JosaUtil } from '@sammo-ts/common';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBuilder } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type { MapDefinition } from '@sammo-ts/logic/world/types.js';
import { parseArgsWithSchema } from '../parseArgs.js';

export interface MoveResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    moveGenerals?: General<TriggerState>[]; // For roaming move
    map?: MapDefinition; // For connectivity check
    develCost?: number;
}

const ACTION_NAME = '이동';
const ACTION_KEY = 'che_이동';
const ARGS_SCHEMA = z.object({
    destCityId: z.number(),
});
export type MoveArgs = z.infer<typeof ARGS_SCHEMA>;

// Helper for map connectivity
const connectedCity = (): Constraint => ({
    name: 'ConnectedCity',
    requires: (ctx) => {
        const reqs: RequirementKey[] = [];
        if (ctx.cityId !== undefined) reqs.push({ kind: 'city', id: ctx.cityId });
        const destCityId = resolveDestCityId(ctx);
        if (destCityId !== undefined) reqs.push({ kind: 'destCity', id: destCityId });
        reqs.push({ kind: 'env', key: 'map' });
        return reqs;
    },
    test: (ctx, view) => {
        const map = view.get({ kind: 'env', key: 'map' }) as MapDefinition | null;
        if (!map) return unknownOrDeny(ctx, [], '지도 정보가 없습니다.');

        const currentCityId = ctx.cityId;
        const destCityId = resolveDestCityId(ctx);

        if (currentCityId === undefined || destCityId === undefined) {
            return unknownOrDeny(ctx, [], '도시 정보가 없습니다.');
        }

        const currentCityDef = map.cities.find((c) => c.id === currentCityId);
        if (!currentCityDef) return unknownOrDeny(ctx, [], '출발 도시 정보가 없습니다.');

        if (currentCityDef.connections.includes(destCityId)) {
            return { kind: 'allow' };
        }
        return { kind: 'deny', reason: '인접하지 않은 도시입니다.' };
    },
});

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, MoveArgs> {
    readonly key = ACTION_KEY;

    resolve(context: MoveResolveContext<TriggerState>, args: MoveArgs): GeneralActionOutcome<TriggerState> {
        const general = context.general;
        const nation = context.nation;
        const { destCityId } = args;

        const effects: GeneralActionEffect<TriggerState>[] = [];

        const isRoamingLeader = general.officerLevel === 12 && nation && nation.level === 0;
        let moveTargets: General<TriggerState>[] = [general];

        if (isRoamingLeader && context.moveGenerals) {
            const others = context.moveGenerals.filter((g) => g.nationId === nation.id && g.id !== general.id);
            moveTargets = [general, ...others];
        }

        const cost = context.develCost ?? 0;

        let destCityName = `도시(${destCityId})`;
        if (context.map) {
            const c = context.map.cities.find((ct) => ct.id === destCityId);
            if (c) destCityName = c.name;
        }

        const josaRo = JosaUtil.pick(destCityName, '로');

        context.addLog(`<G><b>${destCityName}</b></>${josaRo} 이동했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        for (const target of moveTargets) {
            const isSelf = target.id === general.id;

            let nextGold = target.gold;
            let nextAtmos = target.atmos;
            let nextExp = target.experience;
            const nextDed = target.dedication;
            let nextLeadershipExp = typeof target.meta.leadership_exp === 'number' ? target.meta.leadership_exp : 0;

            if (isSelf) {
                nextGold = Math.max(0, nextGold - cost);
                nextAtmos = Math.max(20, nextAtmos - 5);
                nextExp += 50;
                nextLeadershipExp += 1;
            }

            effects.push(
                createGeneralPatchEffect(
                    {
                        ...target,
                        cityId: destCityId,
                        gold: nextGold,
                        atmos: nextAtmos,
                        experience: nextExp,
                        dedication: nextDed,
                        meta: {
                            ...target.meta,
                            leadership_exp: nextLeadershipExp,
                        },
                    },
                    target.id
                )
            );
        }

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, MoveArgs, MoveResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor() {
        this.resolver = new ActionResolver();
    }

    parseArgs(raw: unknown): MoveArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(ctx: ConstraintContext, _args: MoveArgs): Constraint[] {
        return [
            reqGeneralGold(() => {
                const develCost = ctx.env.develCost as number;
                return develCost ?? 0;
            }),
        ];
    }

    buildConstraints(ctx: ConstraintContext, _args: MoveArgs): Constraint[] {
        const constraints = [
            existsDestCity(),
            notSameDestCity(),
            connectedCity(),
            reqGeneralGold(() => {
                const develCost = ctx.env.develCost as number;
                return develCost ?? 0;
            }),
        ];
        return constraints;
    }

    resolve(context: MoveResolveContext<TriggerState>, args: MoveArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder: ActionContextBuilder = (base, options) => {
    return {
        ...base,
        map: options.map,
        develCost: options.scenarioConfig.const.develCost as number | undefined,
        moveGenerals: options.worldRef?.listGenerals() ?? [],
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_이동',
    category: '군사',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
