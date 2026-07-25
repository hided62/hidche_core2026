import type { City, GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import type { Constraint, ConstraintContext } from '@sammo-ts/logic/constraints/types.js';
import {
    notBeNeutral,
    occupiedCity,
    suppliedCity,
    notOccupiedDestCity,
    notNeutralDestCity,
    reqGeneralGold,
    reqGeneralRice,
    disallowDiplomacyBetweenStatus,
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
import { GeneralActionPipeline, type GeneralActionModule } from '@sammo-ts/logic/triggers/general-action.js';
import { consumeSuccessfulStrategyItem } from './strategyItemConsumption.js';

export interface AgitateResolveContext<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends GeneralActionResolveContext<TriggerState> {
    destCity?: City;
    env?: TurnCommandEnv;
}

const ACTION_NAME = '선동';
const ACTION_KEY = 'che_선동';
const ARGS_SCHEMA = z.object({
    destCityId: z.number(),
});
export type AgitateArgs = z.infer<typeof ARGS_SCHEMA>;

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> implements GeneralActionResolver<TriggerState, AgitateArgs> {
    readonly key = ACTION_KEY;
    private readonly pipeline: GeneralActionPipeline<TriggerState>;

    constructor(modules: Array<GeneralActionModule<TriggerState> | null | undefined> = []) {
        this.pipeline = new GeneralActionPipeline(modules);
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: AgitateArgs): GeneralActionOutcome<TriggerState> {
        const ctx = context as AgitateResolveContext<TriggerState>;
        const general = ctx.general;
        const { destCityId } = args;
        const destCity = ctx.destCity;
        if (!destCity) throw new Error('Target city missing');

        const env = ctx.env;
        const cost = env?.develCost ?? 100;

        const effects: GeneralActionEffect<TriggerState>[] = [];

        // Damage calc
        const min = env?.sabotageDamageMin ?? 10;
        const max = env?.sabotageDamageMax ?? 30;
        const rng = ctx.rng;
        if (!rng) throw new Error('RNG missing');

        const secuDmg = rng.nextInt(min, max + 1);
        const trustDmg = rng.nextInt(min, max + 1) / 50;

        const newSecu = Math.max(0, destCity.security - secuDmg);
        const currentTrust = typeof destCity.meta.trust === 'number' ? destCity.meta.trust : 50;
        const newTrust = Math.max(0, currentTrust - trustDmg);

        const actualSecuDmg = destCity.security - newSecu;
        const actualTrustDmg = currentTrust - newTrust;
        const injuryCount = 0;

        // Log
        const commandName = ACTION_NAME;
        const destCityName = destCity.name;
        ctx.addLog(`<G><b>${destCityName}</b></>에 ${commandName}${JosaUtil.pick(commandName, '이')} 성공했습니다.`, {
            category: LogCategory.ACTION,
            format: LogFormat.MONTH,
        });
        ctx.addLog(
            `도시의 치안이 <C>${actualSecuDmg}</>, 민심이 <C>${actualTrustDmg.toFixed(
                1
            )}</>만큼 감소하고, 장수 <C>${injuryCount}</>명이 부상 당했습니다.`,
            {
                category: LogCategory.ACTION,
                format: LogFormat.PLAIN,
            }
        );

        // City Update
        effects.push(
            createCityPatchEffect(
                {
                    ...destCity,
                    security: newSecu,
                    state: 32,
                    meta: {
                        ...destCity.meta,
                        trust: newTrust,
                    },
                },
                destCityId
            )
        );

        consumeSuccessfulStrategyItem(this.pipeline, context);

        // General Update (Cost + Exp + LeaderExp)
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
> implements GeneralActionDefinition<TriggerState, AgitateArgs, GeneralActionResolveContext<TriggerState>> {
    public readonly key = ACTION_KEY;
    public readonly name = ACTION_NAME;
    private readonly resolver: ActionResolver<TriggerState>;

    constructor(env: TurnCommandEnv) {
        this.resolver = new ActionResolver<TriggerState>(
            (env.generalActionModules ?? []) as GeneralActionModule<TriggerState>[]
        );
    }

    parseArgs(raw: unknown): AgitateArgs | null {
        return parseArgsWithSchema(ARGS_SCHEMA, raw);
    }

    buildMinConstraints(ctx: ConstraintContext, _args: AgitateArgs): Constraint[] {
        const env = ctx.env;
        const cost = (env.develCost as number) ?? 100;
        return [notBeNeutral(), occupiedCity(), suppliedCity(), reqGeneralGold(() => cost), reqGeneralRice(() => cost)];
    }

    buildConstraints(ctx: ConstraintContext, _args: AgitateArgs): Constraint[] {
        const env = ctx.env;
        const cost = (env.develCost as number) ?? 100;
        return [
            notBeNeutral(),
            occupiedCity(),
            suppliedCity(),
            notOccupiedDestCity(),
            notNeutralDestCity(),
            reqGeneralGold(() => cost),
            reqGeneralRice(() => cost),
            disallowDiplomacyBetweenStatus({
                7: '불가침국입니다.',
            }),
        ];
    }

    resolve(context: GeneralActionResolveContext<TriggerState>, args: AgitateArgs): GeneralActionOutcome<TriggerState> {
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
    key: 'che_선동',
    category: '군사',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
