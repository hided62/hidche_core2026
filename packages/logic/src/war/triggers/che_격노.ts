import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

export class che_격노시도 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit, raiseType: number = 0) {
        super(unit, TriggerPriority.Pre + 300, raiseType);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!oppose.hasActivatedSkill('필살') && !oppose.hasActivatedSkill('회피')) {
            return true;
        }
        if (self.hasActivatedSkill('격노불가')) {
            return true;
        }

        if (oppose.hasActivatedSkill('필살')) {
            self.activateSkill('격노');
            oppose.deactivateSkill('회피');
            if (self.isAttacker() && self.rng.nextBool(1 / 2)) {
                self.activateSkill('진노');
            }
        } else if (self.rng.nextBool(1 / 4)) {
            self.activateSkill('격노');
            oppose.deactivateSkill('회피');
            if (self.isAttacker() && self.rng.nextBool(1 / 2)) {
                self.activateSkill('진노');
            }
        }
        return true;
    }
}

export class che_격노발동 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit, raiseType: number = 0) {
        super(unit, TriggerPriority.Post + 450, raiseType);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!self.hasActivatedSkill('격노')) {
            return true;
        }

        const targetAct = oppose.hasActivatedSkill('필살') ? '필살 공격' : '회피 시도';
        const is진노 = self.hasActivatedSkill('진노');
        const reaction = is진노 ? '진노' : '격노';

        self.getLogger().pushGeneralBattleDetailLog(`상대의 ${targetAct}에 <C>${reaction}</>했다!</>`, LogFormat.PLAIN);
        oppose
            .getLogger()
            .pushGeneralBattleDetailLog(`${targetAct}에 상대가 <R>${reaction}</>했다!</>`, LogFormat.PLAIN);

        if (is진노) {
            self.addBonusPhase(1);
        }
        self.multiplyWarPowerMultiply(self.criticalDamage());

        return true;
    }
}
