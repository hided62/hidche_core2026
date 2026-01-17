import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

const STAT_VALUE = 4;

const baseModule = createStatItemModule({
    key: 'che_서적_04_건상역주',
    rawName: '건상역주',
    slot: 'book',
    statName: 'intelligence',
    statValue: STAT_VALUE,
    cost: 6000,
    buyable: true,
    reqSecu: 3000,
    extraInfo: '[전투] 계략 시도 확률 +2%p',
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
        if (statName === 'intelligence' && typeof value === 'number') {
            newValue = value + STAT_VALUE;
        }
        if (statName === 'warMagicTrialProb' && typeof newValue === 'number') {
            return newValue + 0.02;
        }
        return newValue;
    } as NonNullable<ItemModule['onCalcStat']>,
};
