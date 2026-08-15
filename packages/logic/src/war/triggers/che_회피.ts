import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import { WarUnitGeneral, type WarUnit } from '@sammo-ts/logic/war/units.js';

export class che_회피시도 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Pre + 200);
    }

    protected actionWar(
        self: WarUnit,
        _oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!(self instanceof WarUnitGeneral)) return true;
        if (self.hasActivatedSkill('특수') || self.hasActivatedSkill('회피불가')) return true;
        if (!self.rng.nextBool(self.getComputedAvoidRatio())) return true;
        self.activateSkill('회피시도', '회피');
        return true;
    }
}

export class che_회피발동 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Post + 500);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!self.hasActivatedSkill('회피')) return true;
        oppose.getLogger().pushGeneralBattleDetailLog('상대가 <R>회피</>했다!</>', LogFormat.PLAIN);
        self.getLogger().pushGeneralBattleDetailLog('<C>회피</>했다!</>', LogFormat.PLAIN);
        oppose.multiplyWarPowerMultiply(1 / 6);
        return true;
    }
}
