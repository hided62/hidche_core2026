import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_간파_노군입산부';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '노군입산부',
    name: '노군입산부(간파)',
    info: '[전투] 상대 회피 확률 -25%p, 상대 필살 확률 -10%p',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    onCalcOpposeStat: function (
        _context: GeneralActionContext | WarActionContext,
        statName: GeneralStatName | WarStatName,
        value: unknown
    ): unknown {
        if (statName === 'warAvoidRatio') {
            return (value as number) - 0.25;
        }
        if (statName === 'warCriticalRatio') {
            return (value as number) - 0.1;
        }
        return value;
    } as NonNullable<ItemModule['onCalcOpposeStat']>,
};
