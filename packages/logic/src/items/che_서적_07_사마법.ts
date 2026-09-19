import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_반계발동, che_반계시도 } from '@sammo-ts/logic/war/triggers/che_반계.js';

const baseModule = createStatItemModule({
    key: 'che_서적_07_사마법',
    rawName: '사마법',
    slot: 'book',
    statName: 'intelligence',
    statValue: 7,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
    extraInfo: '[전투] 상대의 계략을 10% 확률로 되돌림',
});

export const itemModule: ItemModule = {
    ...baseModule,
    getBattlePhaseTriggerList: (context) =>
        context.unit
            ? new WarTriggerCaller(
                  new che_반계시도(
                      context.unit,
                      BaseWarUnitTrigger.TYPE_ITEM + BaseWarUnitTrigger.TYPE_DEDUP_TYPE_BASE * 207,
                      0.1
                  ),
                  new che_반계발동(context.unit)
              )
            : null,
};
