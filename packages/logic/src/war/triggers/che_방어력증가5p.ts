import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

export class che_방어력증가5p extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Final + 200);
    }

    protected actionWar(self: WarUnit, oppose: WarUnit): boolean {
        if (!self.isAttacker()) {
            oppose.multiplyWarPowerMultiply(1 / 1.05);
        }
        return true;
    }
}
