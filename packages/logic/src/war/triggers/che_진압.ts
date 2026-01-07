import { BaseWarUnitTrigger } from '../triggers.js';
import type { WarUnit } from '../units.js';

export class che_진압 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit, raiseType: number = 0) {
        super(unit, 0, raiseType);
    }

    protected actionWar(self: WarUnit): boolean {
        self.activateSkill('반계불가', '격노불가');
        return true;
    }
}
