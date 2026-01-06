import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_회피_태평요술';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '태평요술',
    name: '태평요술(회피)',
    info: '[전투] 회피 확률 +20%p',
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
        if (statName === 'warAvoidRatio') {
            return (value as number) + 0.2;
        }
        return value;
    } as NonNullable<ItemModule['onCalcStat']>,
};
