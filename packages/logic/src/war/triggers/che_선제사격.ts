import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

export class che_선제사격시도 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Begin + 50);
    }

    protected actionWar(self: WarUnit, oppose: WarUnit): boolean {
        if (self.getPhase() !== 0 && oppose.getPhase() !== 0) {
            return true;
        }
        if (self.hasActivatedSkill('선제') || self.hasActivatedSkillOnLog('선제')) {
            return true;
        }
        self.activateSkill('특수', '선제');
        return true;
    }
}

export class che_선제사격발동 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Begin + 51);
    }

    protected actionWar(self: WarUnit, oppose: WarUnit): boolean {
        if (!self.hasActivatedSkill('선제')) {
            return true;
        }
        if (oppose.hasActivatedSkill('선제') && oppose.isAttacker()) {
            return true;
        }

        self.addPhase(-1);
        oppose.addPhase(-1);
        if (oppose.hasActivatedSkill('선제')) {
            self.multiplyWarPowerMultiply(2 / 3);
            oppose.multiplyWarPowerMultiply(2 / 3);
            oppose.getLogger().pushGeneralBattleDetailLog('서로 <C>선제 사격</>을 주고 받았다!</>', LogFormat.PLAIN);
            self.getLogger().pushGeneralBattleDetailLog('서로 <C>선제 사격</>을 주고 받았다!</>', LogFormat.PLAIN);
            return true;
        }

        oppose.multiplyWarPowerMultiply(0);
        self.multiplyWarPowerMultiply(2 / 3);
        self.activateSkill('회피불가', '필살불가', '계략불가');
        oppose.activateSkill('회피불가', '필살불가', '격노불가', '계략불가');

        oppose.getLogger().pushGeneralBattleDetailLog('상대에게 <R>선제 사격</>을 받았다!</>', LogFormat.PLAIN);
        self.getLogger().pushGeneralBattleDetailLog('상대에게 <C>선제 사격</>을 했다!</>', LogFormat.PLAIN);
        return true;
    }
}
