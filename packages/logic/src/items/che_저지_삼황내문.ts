import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { che_저지 } from '@sammo-ts/logic/war/triggers/che_저지.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_저지_삼황내문';

class ActivateItemHalt extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Pre);
    }

    protected actionWar(self: WarUnit): boolean {
        self.activateSkill('특수', '저지');
        return true;
    }
}

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '삼황내문',
    name: '삼황내문(저지)',
    info: '[전투] 수비 시 첫 페이즈 저지, 50% 확률로 2 페이즈 저지',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    getBattlePhaseTriggerList: (context) => {
        const unit = context.unit;
        if (!unit || unit.isAttacker()) {
            return null;
        }

        if (unit.getPhase() > 0) {
            return null;
        }
        const haltCount = unit.hasActivatedSkillOnLog('저지');
        if (haltCount >= 2) {
            return null;
        }
        if (haltCount === 1 && unit.getPhase() === 0 && unit.rng.nextBool(0.5)) {
            return null;
        }

        return new WarTriggerCaller(new ActivateItemHalt(unit), new che_저지(unit));
    },
};
