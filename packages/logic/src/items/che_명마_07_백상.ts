import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

const STAT_VALUE = 7;

const baseModule = createStatItemModule({
    key: 'che_명마_07_백상',
    rawName: '백상',
    slot: 'horse',
    statName: 'leadership',
    statValue: STAT_VALUE,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
    extraInfo: '[전투] 공격력 +20%, 소모 군량 +10%, 공격 시 페이즈 -1',
});

export const itemModule: ItemModule = {
    ...baseModule,
    onCalcStat: function (
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: number | [number, number],
        _aux?: unknown
    ): number | [number, number] {
        let newValue: number | [number, number] = value;
        if (statName === 'leadership' && typeof value === 'number') {
            newValue = value + STAT_VALUE;
        }
        if (statName === 'killRice' && typeof newValue === 'number') {
            return newValue * 1.1;
        }
        if (statName === 'initWarPhase' && typeof newValue === 'number') {
            return newValue - 1;
        }
        return newValue;
    } as NonNullable<ItemModule['onCalcStat']>,
    getWarPowerMultiplier() {
        return [1.2, 1];
    },
};
