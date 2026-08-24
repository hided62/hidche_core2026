import { JosaUtil } from '@sammo-ts/common';
import { createCityPatchEffect, type GeneralActionEffect } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';

import type { GeneralTurnCommandSpec } from './index.js';
import { adjustCityTrust, resolveCityTrustValue } from './cityTrust.js';
import {
    STRATEGY_ARGS_SCHEMA,
    StrategyActionDefinition,
    StrategyActionResolver,
    buildStrategyActionContext,
    type StrategyActionConfig,
    type StrategyArgs,
    type StrategyResolveContext,
    type StrategyResult,
} from './strategyCommand.js';

const CONFIG = {
    key: 'che_선동',
    name: '선동',
    statKey: 'leadership',
    statExpKey: 'leadership_exp',
    damageMode: 'agitate',
    injuryGeneral: true,
} as const satisfies StrategyActionConfig;

export type AgitateArgs = StrategyArgs;
export type AgitateResolveContext<TriggerState extends GeneralTriggerState = GeneralTriggerState> =
    StrategyResolveContext<TriggerState>;

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends StrategyActionResolver<TriggerState> {
    constructor(env: TurnCommandEnv) {
        super(env, CONFIG);
    }

    protected resolveSuccess(
        context: StrategyResolveContext<TriggerState>,
        _args: StrategyArgs,
        result: StrategyResult<TriggerState>,
        effects: GeneralActionEffect<TriggerState>[]
    ): void {
        const currentTrust = resolveCityTrustValue(context.destCity.meta.trust);
        const nextTrust = adjustCityTrust(currentTrust, -result.secondaryAmount);

        effects.push(
            createCityPatchEffect(
                {
                    security: Math.max(0, context.destCity.security - result.primaryAmount),
                    state: 32,
                    meta: {
                        ...context.destCity.meta,
                        trust: nextTrust,
                    },
                },
                context.destCity.id
            )
        );

        const destCityName = context.destCity.name;
        context.addLog(`<G><b>${destCityName}</b></>의 백성들이 동요하고 있습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.SUMMARY,
            format: LogFormat.MONTH,
        });
        context.addLog(
            `<G><b>${destCityName}</b></>에 ${CONFIG.name}${JosaUtil.pick(CONFIG.name, '이')} 성공했습니다.`,
            { format: LogFormat.MONTH }
        );
        context.addLog(
            `도시의 치안이 <C>${result.primaryAmount}</>, 민심이 <C>${result.secondaryAmount.toFixed(
                1
            )}</>만큼 감소하고, 장수 <C>${result.injuryCount}</>명이 부상 당했습니다.`,
            { format: LogFormat.PLAIN }
        );
    }
}

export class ActionDefinition<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends StrategyActionDefinition<TriggerState> {
    constructor(env: TurnCommandEnv) {
        super(env, CONFIG, new ActionResolver<TriggerState>(env));
    }
}

export const actionContextBuilder = buildStrategyActionContext;

export const commandSpec: GeneralTurnCommandSpec = {
    key: CONFIG.key,
    category: '계략',
    reqArg: true,
    availabilityArgs: { destCityId: 0 },
    argsSchema: STRATEGY_ARGS_SCHEMA,
    createDefinition: (env: TurnCommandEnv) => new ActionDefinition(env),
};
