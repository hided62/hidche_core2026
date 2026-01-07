import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '../triggers.js';
import { WarUnitGeneral, type WarUnit } from '../units.js';

export class che_저지_시도 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit, raiseType: number = 0) {
        super(unit, TriggerPriority.Pre, raiseType);
    }
    protected actionWar(u: WarUnit): boolean {
        u.activateSkill('특수', '저지');
        return true;
    }
}

export class che_저지 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit, raiseType: number = 0) {
        super(unit, TriggerPriority.Post, raiseType);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!self.hasActivatedSkill('저지')) {
            return true;
        }

        if (selfEnv['저지발동']) {
            return true;
        }
        selfEnv['저지발동'] = true;

        self.addPhase(-1);
        oppose.addPhase(-1);
        if (self.getPhase() < self.getMaxPhase()) {
            oppose.addBonusPhase(-1);
        }

        self.getLogger().pushGeneralBattleDetailLog('상대를 <C>저지</>했다!', LogFormat.PLAIN);
        oppose.getLogger().pushGeneralBattleDetailLog('<R>저지</>당했다!', LogFormat.PLAIN);

        const calcDamage = oppose.getWarPower() * 0.9;
        if (self instanceof WarUnitGeneral) {
            self.addDex(oppose.getCrewType(), oppose.getWarPower() * 0.9);
            self.addDex(self.getCrewType(), calcDamage);

            self.addLevelExp(calcDamage / 50);
            let rice = self.calcRiceConsumption(calcDamage);
            rice *= 0.25;
            const general = self.getGeneral();
            general.rice = Math.max(0, general.rice - rice);
        }

        self.setWarPowerMultiply(0);
        oppose.setWarPowerMultiply(0);

        return false;
    }
}
