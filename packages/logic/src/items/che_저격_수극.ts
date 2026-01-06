import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { CheSnipingAttemptTrigger, CheSnipingActivateTrigger } from '@sammo-ts/logic/war/triggers/che_저격.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_저격_수극';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '수극',
    name: '수극(저격)',
    info: '[전투] 전투 개시 시 저격. 1회용',
    slot: 'item',
    cost: 1000,
    buyable: true,
    consumable: true,
    reqSecu: 1000,
    unique: false,
    getBattlePhaseTriggerList: (context) => {
        if (!context.unit) return null;
        return new WarTriggerCaller(
            new CheSnipingAttemptTrigger(context.unit, BaseWarUnitTrigger.TYPE_CONSUMABLE_ITEM, 1, 20, 40),
            new CheSnipingActivateTrigger(context.unit, BaseWarUnitTrigger.TYPE_CONSUMABLE_ITEM)
        );
    },
};
