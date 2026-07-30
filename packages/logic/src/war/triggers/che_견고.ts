import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

export class che_부상무효 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit, raiseType = BaseWarUnitTrigger.TYPE_NONE) {
        super(unit, TriggerPriority.Begin + 200, raiseType);
    }

    protected actionWar(
        self: WarUnit,
        _oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        self.activateSkill('부상무효');
        return true;
    }
}
