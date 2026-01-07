import { BaseWarUnitTrigger } from '../triggers.js';
import type { WarUnit } from '../units.js';

export class che_부적 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit, raiseType: number = 0) {
        super(unit, 0, raiseType);
    }

    protected actionWar(self: WarUnit): boolean {
        self.activateSkill('저격불가', '부상무효');
        return true;
    }
}
