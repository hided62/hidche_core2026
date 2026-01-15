import type { City, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    notOccupiedDestCity,
    reqGeneralGold,
    reqGeneralRice,
    existsDestCity,
} from '@sammo-ts/logic/constraints/presets.js';
import type { GeneralActionDefinition } from '@sammo-ts/logic/actions/definition.js';
import type {
    GeneralActionOutcome,
    GeneralActionResolveContext,
    GeneralActionResolver,
    GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import { createGeneralPatchEffect, createCityPatchEffect } from '@sammo-ts/logic/actions/engine.js';
import { LogCategory, LogFormat } from '@sammo-ts/logic/logging/types.js';
import { z } from 'zod';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { ActionContextBase, ActionContextOptions } from '@sammo-ts/logic/actions/turn/actionContext.js';
import type { GeneralTurnCommandSpec } from './index.js';
import { JosaUtil } from '@sammo-ts/common';
import { parseArgsWithSchema } from '../parseArgs.js';

export interface DestroyResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity?: City;
    env?: TurnCommandEnv;
}

const ACTION_NAME = '파괴';
const ACTION_KEY = 'che_파괴';
const ARGS_SCHEMA = z.object({
    destCityId: z.number(),
});
export type DestroyArgs = z.infer<typeof ARGS_SCHEMA>;

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, DestroyArgs> {
    readonly key = ACTION_KEY;

    resolve(context: GeneralActionResolveContext<TriggerState>, args: DestroyArgs): GeneralActionOutcome<TriggerState> {
        const ctx = context as DestroyResolveContext<TriggerState>;
        const general = ctx.general;
        const { destCityId } = args;
        const destCity = ctx.destCity;
        if (!destCity) throw new Error('Target city missing');

        const env = ctx.env;
        const cost = env?.develCost ?? 100; // 1x develCost

        const effects: GeneralActionEffect<TriggerState>[] = [];

        // Damage calc
        const min = env?.sabotageDamageMin ?? 10;
        const max = env?.sabotageDamageMax ?? 30;
        const rng = ctx.rng;

        if (!rng) throw new Error('RNG missing');

        const defDmg = rng.nextInt(min, max + 1);
        const wallDmg = rng.nextInt(min, max + 1);

        const newDef = Math.max(0, destCity.defence - defDmg);
        const newWall = Math.max(0, destCity.wall - wallDmg);

        const actualDefDmg = destCity.defence - newDef;
        const actualWallDmg = destCity.wall - newWall;

        // Log
        const destCityName = destCity.name;
        ctx.addLog(`<G>${destCityName}</>에 ${ACTION_NAME}${JosaUtil.pick(ACTION_NAME, '이')} 성공했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        ctx.addLog(`수비가 ${actualDefDmg}, 성벽이 ${actualWallDmg} 만큼 감소했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });

        // City Update
        effects.push(
            createCityPatchEffect(
                {
                    ...destCity,
                    defence: newDef,
                    wall: newWall,
                    state: 32, // Legacy sabotage state
                },
                destCityId
            )
        );

        // General Update (Cost + Exp)
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
                        strength_exp:
                            (typeof general.meta.strength_exp === 'number' ? general.meta.strength_exp : 0) + 1,
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
> implements GeneralActionDefinition<TriggerState, DestroyArgs, GeneralActionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(_env: TurnCommandEnv) {
        this.resolver = new ActionResolver();
    }

    parseArgs(raw: unknown): DestroyArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildConstraints(ctx: ConstraintContext, _args: DestroyArgs): Constraint[] {
        const env = ctx.env;
        const cost = (env.develCost as number) ?? 100;
        return [
            notBeNeutral(),
            existsDestCity(),
            reqGeneralGold(() => cost),
            reqGeneralRice(() => cost),
            notOccupiedDestCity(),
        ];
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: DestroyArgs): GeneralActionOutcome<TriggerState> {
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
        env: options.scenarioConfig.const as unknown as TurnCommandEnv,
    };
};

export const commandSpec: GeneralTurnCommandSpec = {
    key: 'che_파괴',
    category: '군사',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
