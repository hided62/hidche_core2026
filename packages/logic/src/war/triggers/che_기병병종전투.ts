import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import { WarUnitCity, type WarUnit } from '@sammo-ts/logic/war/units.js';

export class che_기병병종전투 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Final + 100);
    }

    protected actionWar(self: WarUnit, oppose: WarUnit): boolean {
        if (!self.isAttacker()) {
            oppose.multiplyWarPowerMultiply(1.02);
            self.multiplyWarPowerMultiply(0.97);
        } else if (oppose instanceof WarUnitCity) {
            self.multiplyWarPowerMultiply(0.9);
        } else {
            oppose.multiplyWarPowerMultiply(0.97);
            self.multiplyWarPowerMultiply(1.02);
        }
        return true;
    }
}
