import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_숙련_동작';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '동작',
    name: '동작(숙련)',
    info: '숙련 +20%',
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
        if (statName === ('addDex' as unknown as GeneralStatName)) {
            return (value as number) * 1.2;
        }
        return value;
    } as NonNullable<ItemModule['onCalcStat']>,
};
