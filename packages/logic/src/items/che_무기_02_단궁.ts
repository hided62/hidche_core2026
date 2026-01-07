import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_저격발동, che_저격시도 } from '@sammo-ts/logic/war/triggers/che_저격.js';
import { createStatItemModule } from './base.js';
import type { ItemModule } from './types.js';

const raiseType = BaseWarUnitTrigger.TYPE_ITEM + BaseWarUnitTrigger.TYPE_DEDUP_TYPE_BASE * 102;

const baseModule = createStatItemModule({
    key: 'che_무기_02_단궁',
    rawName: '단궁',
    slot: 'weapon',
    statName: 'strength',
    statValue: 2,
    cost: 3000,
    buyable: true,
    reqSecu: 2000,
    extraInfo: '[전투] 새로운 상대와 전투 시 1% 확률로 저격 발동, 성공 시 사기+20',
});

export const itemModule: ItemModule = {
    ...baseModule,
    getBattlePhaseTriggerList: (context) => {
        if (!context.unit) {
            return null;
        }
        return new WarTriggerCaller(
            new che_저격시도(context.unit, raiseType, 0.01, 10, 30),
            new che_저격발동(context.unit, raiseType)
        );
    },
};
