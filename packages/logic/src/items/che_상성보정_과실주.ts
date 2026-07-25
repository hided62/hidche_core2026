import type { ItemModule } from './types.js';
import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { 전투력보정 } from '@sammo-ts/logic/war/triggers/전투력보정.js';

const ITEM_KEY = 'che_상성보정_과실주';

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '과실주',
    name: '과실주(상성)',
    info: '[전투] 대등/유리한 병종 전투시 공격력 +10%, 피해 -10%',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    getBattlePhaseTriggerList: (context) => {
        const unit = context.unit;
        const oppose = unit?.getOppose();
        if (!unit || !oppose) {
            return null;
        }
        const attackCoef = unit.getCrewType().getAttackCoef(oppose.getCrewType());
        if (attackCoef < 1) {
            return null;
        }
        return new WarTriggerCaller(new 전투력보정(unit, 1.1, 0.9));
    },
};
