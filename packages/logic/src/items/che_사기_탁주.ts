import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_사기 } from '@sammo-ts/logic/war/triggers/che_사기.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_사기_탁주';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '탁주',
    name: '탁주(사기)',
    info: '[전투] 사기 +30(한도 내). 1회용',
    slot: 'item',
    cost: 1000,
    buyable: true,
    consumable: true,
    reqSecu: 1000,
    unique: false,
    getBattleInitTriggerList: (context) => {
        if (!context.unit) return null;
        return new WarTriggerCaller(new che_사기(context.unit, BaseWarUnitTrigger.TYPE_CONSUMABLE_ITEM, 30));
    },
};
