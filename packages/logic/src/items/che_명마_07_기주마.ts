import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

const baseModule = createStatItemModule({
    key: 'che_명마_07_기주마',
    rawName: '기주마',
    slot: 'horse',
    statName: 'leadership',
    statValue: 7,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
    extraInfo: '[전투] 공격 시 페이즈 +1',
});

export const itemModule: ItemModule = {
    ...baseModule,
    onCalcStat: function (
        context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: unknown,
        aux?: unknown
    ): unknown {
        const newValue = baseModule.onCalcStat!(context as never, statName as never, value as never, aux);
        if (statName === 'initWarPhase') {
            return (newValue as number) + 1;
        }
        return newValue;
    } as NonNullable<ItemModule['onCalcStat']>,
};
