import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_약탈발동, che_약탈시도 } from '@sammo-ts/logic/war/triggers/che_약탈.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_약탈_옥벽';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '옥벽',
    name: '옥벽(약탈)',
    info: '[전투] 새로운 상대와 전투 시 20% 확률로 상대 금, 쌀 10% 약탈',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    getBattlePhaseTriggerList: (context) => {
        if (!context.unit) return null;
        return new WarTriggerCaller(
            new che_약탈시도(context.unit, BaseWarUnitTrigger.TYPE_ITEM, 0.2, 0.1),
            new che_약탈발동(context.unit, BaseWarUnitTrigger.TYPE_ITEM)
        );
    },
};
