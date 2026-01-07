import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

export class che_돌격지속 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Post + 900);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        // WarUnitCity check
        if (oppose.constructor.name === 'WarUnitCity') {
            return true;
        }
        if (!self.isAttacker()) {
            return true;
        }
        const attackCoef = self.getCrewType().getAttackCoef(oppose.getCrewType());
        if (attackCoef < 1) {
            if (oppose.hasActivatedSkill('선제') && self.getPhase() >= self.getMaxPhase() - 2) {
                self.addBonusPhase(-1);
            }
            return true;
        }
        if (self.getPhase() < self.getMaxPhase() - 1) {
            return true;
        }
        self.addBonusPhase(1);
        return true;
    }
}
