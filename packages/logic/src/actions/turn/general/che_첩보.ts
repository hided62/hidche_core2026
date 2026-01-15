import type { City, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    notOccupiedDestCity,
    reqGeneralGold,
    reqGeneralRice,
    existsDestCity,
    notBeNeutral,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
    GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createNationPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBase, ActionContextOptions } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import type { MapDefinition } from '@sammo-ts/logic/world/types.js';
import { parseArgsWithSchema } from '../parseArgs.js';

export interface SpyResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity?: City;
    env?: TurnCommandEnv;
    map?: MapDefinition;
}

const ACTION_NAME = '첩보';
const ACTION_KEY = 'che_첩보';
const ARGS_SCHEMA = z.object({
    destCityId: z.number(),
});
export type SpyArgs = z.infer<typeof ARGS_SCHEMA>;

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, SpyArgs> {
    readonly key = ACTION_KEY;

    resolve(context: GeneralActionResolveContext<TriggerState>, args: SpyArgs): GeneralActionOutcome<TriggerState> {
        const ctx = context as SpyResolveContext<TriggerState>;
        const general = ctx.general;
        const nation = ctx.nation;
        const { destCityId } = args;

        const destCity = ctx.destCity;
        if (!destCity) throw new Error('Target city missing');

        const env = ctx.env;
        const cost = (env?.develCost ?? 100) * 3;

        const effects: GeneralActionEffect<TriggerState>[] = [];

        const currentCityId = general.cityId;
        let isAdjacent = false;
        if (ctx.map) {
            const cityDef = ctx.map.cities.find((c) => c.id === currentCityId);
            if (cityDef && (cityDef.connections.includes(destCityId) || currentCityId === destCityId)) {
                isAdjacent = true;
            }
        }

        const destCityName = destCity.name;
        ctx.addLog(`<G>${destCityName}</>의 정보를 ${isAdjacent ? '많이' : '어느 정도'} 얻었습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        const trust = destCity.meta.trust ?? '?';
        ctx.addLog(`주민:${destCity.population}, 민심:${trust}, ...`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
            scope: LogScope.GENERAL,
        });

        if (nation) {
            const spyInfo = (nation.meta.spy as unknown as Record<string, number>) || {};
            const newSpyInfo = { ...spyInfo, [destCityId]: 3 };

            effects.push(
                createNationPatchEffect(
                    {
                        ...nation,
                        meta: { ...nation.meta, spy: newSpyInfo as unknown as string }, // Workaround for TriggerValue mismatch, engine handles nested objects in meta sometimes or we should JSON stringify.
                    },
                    nation.id
                )
            );
        }

        effects.push(
            createGeneralPatchEffect(
                {
                    ...general,
                    gold: Math.max(0, general.gold - cost),
                    rice: Math.max(0, general.rice - cost),
                    experience: general.experience + 50,
                    dedication: general.dedication + 30,
                    meta: {
                        ...general.meta,
                        leadership_exp:
                            (typeof general.meta.leadership_exp === 'number' ? general.meta.leadership_exp : 0) + 1,
                    },
                },
                general.id
            )
        );

        return { effects };
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionDefinition<TriggerState, SpyArgs, GeneralActionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor() {
        this.resolver = new ActionResolver();
    }

    parseArgs(raw: unknown): SpyArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(ctx: ConstraintContext, _args: SpyArgs): Constraint[] {
        const env = ctx.env;
        const cost = ((env.develCost as number) ?? 100) * 3;
        return [notBeNeutral(), reqGeneralGold(() => cost), reqGeneralRice(() => cost)];
    }

    buildConstraints(ctx: ConstraintContext, _args: SpyArgs): Constraint[] {
        const env = ctx.env;
        const cost = ((env.develCost as number) ?? 100) * 3;
        return [
            notBeNeutral(),
            existsDestCity(),
            reqGeneralGold(() => cost),
            reqGeneralRice(() => cost),
            notOccupiedDestCity(),
        ];
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: SpyArgs): GeneralActionOutcome<TriggerState> {
        return this.resolver.resolve(context, args);
    }
}

export const actionContextBuilder = (base: ActionContextBase, options: ActionContextOptions) => {
    const destCityId = options.actionArgs?.destCityId;
    let destCity = null;
    if (typeof destCityId === 'number' && options.worldRef) {
        destCity = options.worldRef.getCityById(destCityId);
    }
    return {
        ...base,
        destCity,
        map: options.map,
        env: options.scenarioConfig.const as unknown as TurnCommandEnv,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_첩보',
    category: '군사',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (_env: TurnCommandEnv) => new ActionDefinition(),
};
