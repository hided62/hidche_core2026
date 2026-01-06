import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_훈련_철벽서';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '철벽서',
    name: '철벽서(훈련)',
    info: '[전투] 훈련 보정 +15',
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
        if (statName === 'bonusTrain') {
            return (value as number) + 15;
        }
        return value;
    } as NonNullable<ItemModule['onCalcStat']>,
};
