import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

export class 전투력보정 extends BaseWarUnitTrigger {
    constructor(
        unit: WarUnit,
        private readonly attackMultiplier: number,
        private readonly defenceMultiplier = 1
    ) {
        super(unit, TriggerPriority.Begin + 20);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        self.multiplyWarPowerMultiply(this.attackMultiplier);
        oppose.multiplyWarPowerMultiply(this.defenceMultiplier);
        return true;
    }
}
