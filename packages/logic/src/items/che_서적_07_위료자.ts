import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/actionModules/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

const STAT_VALUE = 7;

const baseModule = createStatItemModule({
    key: 'che_서적_07_위료자',
    rawName: '위료자',
    slot: 'book',
    statName: 'intelligence',
    statValue: STAT_VALUE,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
    extraInfo: '[전투] 계략 시도 확률 +20%p',
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
            return newValue + 0.2;
        }
        return newValue;
    } as NonNullable<ItemModule['onCalcStat']>,
};
