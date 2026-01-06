import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

const baseModule = createStatItemModule({
    key: 'che_명마_07_백상',
    rawName: '백상',
    slot: 'horse',
    statName: 'leadership',
    statValue: 7,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
    extraInfo: '[전투] 공격력 +20%, 소모 군량 +10%, 공격 시 페이즈 -1',
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
        if (statName === 'killRice') {
            return (newValue as number) * 1.1;
        }
        if (statName === 'initWarPhase') {
            return (newValue as number) - 1;
        }
        return newValue;
    } as NonNullable<ItemModule['onCalcStat']>,
    getWarPowerMultiplier() {
        return [1.2, 1];
    },
};
