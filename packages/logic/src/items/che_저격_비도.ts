import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_저격발동, che_저격시도 } from '@sammo-ts/logic/war/triggers/che_저격.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import type { ItemModule } from './types.js';

const RAISE_TYPE = BaseWarUnitTrigger.TYPE_ITEM + BaseWarUnitTrigger.TYPE_DEDUP_TYPE_BASE * 305;

export const itemModule: ItemModule = {
    key: 'che_저격_비도',
    rawName: '비도',
    name: '비도(저격)',
    info: '[전투] 새로운 상대와 전투 시 50% 확률로 저격 발동, 성공 시 사기+20',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: true,
    getBattlePhaseTriggerList: (context) => {
        if (!context.unit) {
            return null;
        }
        return new WarTriggerCaller(
            new che_저격시도(context.unit, RAISE_TYPE, 0.5, 20, 40),
            new che_저격발동(context.unit, RAISE_TYPE)
        );
    },
};
