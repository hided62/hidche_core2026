import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '../triggers.js';
import type { WarUnit } from '../units.js';

export class che_부적 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit, raiseType: number = 0) {
        super(unit, TriggerPriority.Begin, raiseType);
    }

    protected actionWar(_self: WarUnit, oppose: WarUnit): boolean {
        // Ref WarActivateSkills(..., isSelf=false): the talisman's owner is
        // injury-proof, while the opposing unit is prevented from sniping.
        oppose.activateSkill('저격불가');
        return true;
    }
}
