import { JosaUtil } from '@sammo-ts/common';
import {
    createCityPatchEffect,
    createNationPatchEffect,
    type GeneralActionEffect,
} from '@sammo-ts/logic/actions/engine.js';
import type { TurnCommandEnv } from '@sammo-ts/logic/actions/turn/commandEnv.js';
import type { GeneralTriggerState } from '@sammo-ts/logic/domain/entities.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic/logging/types.js';

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
    key: 'che_탈취',
    name: '탈취',
    statKey: 'strength',
    statExpKey: 'strength_exp',
    damageMode: 'seize',
    injuryGeneral: false,
} as const satisfies StrategyActionConfig;

export type SeizeArgs = StrategyArgs;
export type SeizeResolveContext<TriggerState extends GeneralTriggerState = GeneralTriggerState> =
    StrategyResolveContext<TriggerState>;

export class ActionResolver<
    TriggerState extends GeneralTriggerState = GeneralTriggerState,
> extends StrategyActionResolver<TriggerState> {
    constructor(env: TurnCommandEnv) {
        super(env, CONFIG);
    }

    protected resolveSuccess(
        context: StrategyResolveContext<TriggerState>,
        args: StrategyArgs,
        result: StrategyResult<TriggerState>,
        effects: GeneralActionEffect<TriggerState>[]
    ): void {
        const { general, nation, destCity, destNation } = context;
        const currentYear = context.year ?? 200;
        const startYear = context.startYear ?? currentYear;
        const yearCoefficient = Math.sqrt(1 + Math.max(0, currentYear - startYear) / 4) / 2;
        const commerceRatio = destCity.commerce / destCity.commerceMax;
        const agricultureRatio = destCity.agriculture / destCity.agricultureMax;

        let stolenGold = result.primaryAmount * destCity.level * yearCoefficient * (0.25 + commerceRatio / 4);
        let stolenRice = result.secondaryAmount * destCity.level * yearCoefficient * (0.25 + agricultureRatio / 4);

        if (destCity.supplyState === 1 && destNation) {
            stolenGold = Math.min(stolenGold, Math.max(0, destNation.gold));
            stolenRice = Math.min(stolenRice, Math.max(0, destNation.rice));
            effects.push(
                createNationPatchEffect(
                    {
                        gold: Math.round(destNation.gold - stolenGold),
                        rice: Math.round(destNation.rice - stolenRice),
                    },
                    destNation.id
                )
            );
        }

        // Ref는 미보급 도시의 일시 자원 감소를 원본 destCity 저장으로 덮어쓴다.
        effects.push(createCityPatchEffect({ state: 32 }, args.destCityId));

        let generalShareGold = stolenGold;
        let generalShareRice = stolenRice;
        if (nation && nation.id !== 0) {
            const nationShareGold = Math.round(stolenGold * 0.7);
            const nationShareRice = Math.round(stolenRice * 0.7);
            generalShareGold -= nationShareGold;
            generalShareRice -= nationShareRice;
            effects.push(
                createNationPatchEffect(
                    {
                        gold: nation.gold + nationShareGold,
                        rice: nation.rice + nationShareRice,
                    },
                    nation.id
                )
            );
        }
        general.gold = Math.round(general.gold + generalShareGold);
        general.rice = Math.round(general.rice + generalShareRice);

        const destCityName = destCity.name;
        context.addLog(`<G><b>${destCityName}</b></>에서 금과 쌀을 도둑맞았습니다.`, {
            scope: LogScope.SYSTEM,
            category: LogCategory.SUMMARY,
            format: LogFormat.MONTH,
        });
        context.addLog(
            `<G><b>${destCityName}</b></>에 ${CONFIG.name}${JosaUtil.pick(CONFIG.name, '이')} 성공했습니다.`,
            { format: LogFormat.MONTH }
        );
        context.addLog(
            `금<C>${Math.round(stolenGold).toLocaleString('en-US')}</> 쌀<C>${Math.round(stolenRice).toLocaleString(
                'en-US'
            )}</>을 획득했습니다.`,
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
