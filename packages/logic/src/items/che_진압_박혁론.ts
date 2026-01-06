import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_진압_박혁론';

class CheSuppressTrigger extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, 0); // Priority 0 or matching legacy
    }

    protected actionWar(self: WarUnit): boolean {
        self.activateSkill('반계불가', '격노불가');
        return true;
    }
}

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
        return new WarTriggerCaller(new CheSuppressTrigger(context.unit));
    },
};
