import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

type AtmosUnit = WarUnit & { addAtmos: (amount: number) => void };

const canAddAtmos = (unit: WarUnit): unit is AtmosUnit =>
    'addAtmos' in unit && typeof (unit as { addAtmos?: unknown }).addAtmos === 'function';

export class che_위압시도 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Begin + 100);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (self.getPhase() !== 0 && oppose.getPhase() !== 0) {
            return true;
        }
        if (self.hasActivatedSkill('위압불가')) {
            return true;
        }

        self.activateSkill('위압');
        oppose.activateSkill('회피불가', '필살불가', '계략불가');
        return true;
    }
}

export class che_위압발동 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, TriggerPriority.Post + 700);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!self.hasActivatedSkill('위압')) {
            return true;
        }

        oppose.getLogger().pushGeneralBattleDetailLog('상대에게 <R>위압</>받았다!', LogFormat.PLAIN);
        self.getLogger().pushGeneralBattleDetailLog('상대에게 <C>위압</>을 줬다!', LogFormat.PLAIN);
        oppose.setWarPowerMultiply(0);
        if (canAddAtmos(oppose)) {
            oppose.addAtmos(-5);
        }

        return true;
    }
}
