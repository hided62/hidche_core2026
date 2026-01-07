import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_훈련 } from '@sammo-ts/logic/war/triggers/che_훈련.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_훈련_청주';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '청주',
    name: '청주(훈련)',
    info: '[전투] 훈련 +40(한도 내). 1회용',
    slot: 'item',
    cost: 1000,
    buyable: true,
    consumable: true,
    reqSecu: 1000,
    unique: false,
    getBattleInitTriggerList: (context) => {
        if (!context.unit) return null;
        return new WarTriggerCaller(new che_훈련(context.unit, BaseWarUnitTrigger.TYPE_CONSUMABLE_ITEM, 40));
    },
};
