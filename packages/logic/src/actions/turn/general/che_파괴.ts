import { JosaUtil } from '@sammo-ts/common';
import { createCityPatchEffect, type GeneralActionEffect } from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { LogFormat, LogCategory, LogScope } from '@sammo-ts/logic/logging/types.js';

import type { GeneralTurnCommandSpec } from './index.js';
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
    key: 'che_파괴',
    name: '파괴',
    statKey: 'strength',
    statExpKey: 'strength_exp',
    damageMode: 'destroy',
    injuryGeneral: true,
} as const satisfies StrategyActionConfig;

export type DestroyArgs = StrategyArgs;
export type DestroyResolveContext<TriggerState extends GeneralTriggerState = GeneralTriggerState> =
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
        effects.push(
            createCityPatchEffect(
                {
                    defence: Math.max(0, context.destCity.defence - result.primaryAmount),
                    wall: Math.max(0, context.destCity.wall - result.secondaryAmount),
                    state: 32,
                },
                context.destCity.id
            )
        );

        const destCityName = context.destCity.name;
        context.addLog(`누군가가 <G><b>${destCityName}</b></>의 성벽을 허물었습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.SUMMARY,
            format: LogFormat.MONTH,
        });
        context.addLog(
            `<G><b>${destCityName}</b></>에 ${CONFIG.name}${JosaUtil.pick(CONFIG.name, '이')} 성공했습니다.`,
            { format: LogFormat.MONTH }
        );
        context.addLog(
            `도시의 수비가 <C>${result.primaryAmount}</>, 성벽이 <C>${result.secondaryAmount}</>만큼 감소하고, 장수 <C>${result.injuryCount}</>명이 부상 당했습니다.`,
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
