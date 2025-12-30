import { LogFormat } from '../logging/types.js';
import { TriggerPriority } from '../triggers/core.js';
import { BaseWarUnitTrigger } from './triggers.js';
import { WarUnitGeneral, type WarUnit } from './units.js';

// 기본 필살: 시도 단계
export class ChePilsalAttemptTrigger extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Pre + 120);
    }

    protected actionWar(
        self: WarUnit,
        _oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!(self instanceof WarUnitGeneral)) {
            return true;
        }
        if (self.hasActivatedSkill('특수')) {
            return true;
        }
        if (self.hasActivatedSkill('필살불가')) {
            return true;
        }
        if (!self.rng.nextBool(self.getComputedCriticalRatio())) {
            return true;
        }
        self.activateSkill('필살시도', '필살');
        return true;
    }
}

// 기본 필살: 발동 단계
export class ChePilsalActivateTrigger extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Post + 400);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!self.hasActivatedSkill('필살')) {
            return true;
        }
        if (selfEnv['필살발동']) {
            return true;
        }
        selfEnv['필살발동'] = true;

        oppose
            .getLogger()
            .pushGeneralBattleDetailLog('상대의 <R>필살</>공격!</>', LogFormat.PLAIN);
        self
            .getLogger()
            .pushGeneralBattleDetailLog('<C>필살</>공격!</>', LogFormat.PLAIN);

        self.multiplyWarPowerMultiply(self.criticalDamage());
        return true;
    }
}
