import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import { WarUnitCity, WarUnitGeneral, type WarUnit } from '@sammo-ts/logic/war/units.js';

export class che_성벽부상무효 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Begin + 150);
    }

    protected actionWar(self: WarUnit, oppose: WarUnit): boolean {
        if (!(self instanceof WarUnitGeneral) || !(oppose instanceof WarUnitCity)) {
            return true;
        }
        self.activateSkill('부상무효');
        return true;
    }
}
