import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

const baseModule = createStatItemModule({
    key: 'che_서적_07_위료자',
    rawName: '위료자',
    slot: 'book',
    statName: 'intelligence',
    statValue: 7,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
    extraInfo: '[전투] 계략 시도 확률 +20%p',
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
            return (newValue as number) + 0.2;
        }
        return newValue;
    } as NonNullable<ItemModule['onCalcStat']>,
};
