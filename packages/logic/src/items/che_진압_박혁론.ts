import { che_진압 } from '@sammo-ts/logic/war/triggers/che_진압.js';

import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_진압_박혁론';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '박혁론',
    name: '박혁론(진압)',
    info: '[전투] 상대의 계략 되돌림, 격노 불가',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    getBattlePhaseTriggerList: (context) => {
        if (!context.unit) return null;
        return new WarTriggerCaller(new che_진압(context.unit));
    },
};
