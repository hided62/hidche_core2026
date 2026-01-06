import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_사기_초선화';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '초선화',
    name: '초선화(사기)',
    info: '[전투] 사기 보정 +15',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    onCalcStat: function (
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: unknown
    ): unknown {
        if (statName === 'bonusAtmos') {
            return (value as number) + 15;
        }
        return value;
    } as NonNullable<ItemModule['onCalcStat']>,
};
