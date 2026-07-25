import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_저격발동, che_저격시도 } from '@sammo-ts/logic/war/triggers/che_저격.js';

const baseModule = createStatItemModule({
    key: 'che_무기_07_맥궁',
    rawName: '맥궁',
    slot: 'weapon',
    statName: 'strength',
    statValue: 7,
    cost: 200,
    buyable: false,
    reqSecu: 0,
    unique: true,
    extraInfo: '[전투] 새로운 상대와 전투 시 20% 확률로 저격 발동, 성공 시 사기+20',
});

const raiseType = BaseWarUnitTrigger.TYPE_ITEM + BaseWarUnitTrigger.TYPE_DEDUP_TYPE_BASE * 107;

export const itemModule: ItemModule = {
    ...baseModule,
    getBattlePhaseTriggerList: (context) =>
        context.unit
            ? new WarTriggerCaller(
                  new che_저격시도(context.unit, raiseType, 0.2, 20, 40),
                  new che_저격발동(context.unit, raiseType)
              )
            : null,
};
