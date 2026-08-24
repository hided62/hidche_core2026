import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '../triggers.js';
import type { WarUnit } from '../units.js';

export class che_진압 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit, raiseType: number = 0) {
        super(unit, TriggerPriority.Begin, raiseType);
    }

    protected actionWar(_self: WarUnit, oppose: WarUnit): boolean {
        // Ref's 진압 is an opposing-unit restriction, not a self debuff.
        oppose.activateSkill('반계불가', '격노불가');
        return true;
    }
}
