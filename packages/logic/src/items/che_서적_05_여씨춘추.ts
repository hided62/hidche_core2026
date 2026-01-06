import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

const STAT_VALUE = 5;

const baseModule = createStatItemModule({
    key: 'che_서적_05_여씨춘추',
    rawName: '여씨춘추',
    slot: 'book',
    statName: 'intelligence',
    statValue: STAT_VALUE,
    cost: 7500,
    buyable: true,
    reqSecu: 3500,
    extraInfo: '[전투] 계략 시도 확률 +3%p',
});

export const itemModule: ItemModule = {
    ...baseModule,
    onCalcStat: function (
        context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: unknown,
        aux?: unknown
    ): unknown {
        const newValue = baseModule.onCalcStat!(
            context as unknown as GeneralActionContext,
            statName as unknown as GeneralStatName,
            value as unknown as number,
            aux
        );
        if (statName === 'warMagicTrialProb') {
            return (newValue as number) + 0.03;
        }
        return newValue;
    } as NonNullable<ItemModule['onCalcStat']>,
};
