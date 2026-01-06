import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_필살_둔갑천서';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '둔갑천서',
    name: '둔갑천서(필살)',
    info: '[전투] 필살 확률 +20%p',
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
        if (statName === 'warCriticalRatio') {
            return (value as number) + 0.2;
        }
        return value;
    } as NonNullable<ItemModule['onCalcStat']>,
};
