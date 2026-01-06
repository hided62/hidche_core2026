import { LogFormat } from '@sammo-ts/logic/logging/types.js';
import { TriggerPriority } from '@sammo-ts/logic/triggers/core.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';
import type { ItemModule } from './types.js';

const ITEM_KEY = 'che_격노_구정신단경';

class CheRageAttemptTrigger extends BaseWarUnitTrigger {
    constructor(unit: WarUnit, raiseType: number) {
        super(unit, TriggerPriority.Body + 400, raiseType);
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
            if (self.isAttacker() && self.rng.nextBool(0.5)) {
                self.activateSkill('진노');
            }
        } else if (self.rng.nextBool(0.25)) {
            self.activateSkill('격노');
            oppose.deactivateSkill('회피');
            if (self.isAttacker() && self.rng.nextBool(0.5)) {
                self.activateSkill('진노');
            }
        }
        return true;
    }
}

class CheRageActivateTrigger extends BaseWarUnitTrigger {
    constructor(unit: WarUnit, raiseType: number) {
        super(unit, TriggerPriority.Post + 600, raiseType);
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
        const isJinno = self.hasActivatedSkill('진노');
        const reaction = isJinno ? '진노' : '격노';

        self.getLogger().pushGeneralBattleDetailLog(`상대의 ${targetAct}에 <C>${reaction}</>했다!</>`, LogFormat.PLAIN);
        oppose
            .getLogger()
            .pushGeneralBattleDetailLog(`${targetAct}에 상대가 <R>${reaction}</>했다!</>`, LogFormat.PLAIN);

        if (isJinno) {
            self.addBonusPhase(1);
        }
        self.multiplyWarPowerMultiply(self.criticalDamage());
        return true;
    }
}

export const itemModule: ItemModule = {
    key: ITEM_KEY,
    rawName: '구정신단경',
    name: '구정신단경(격노)',
    info: '[전투] 상대방 필살 시 격노(필살) 발동, 회피 시도시 25% 확률로 격노 발동, 공격 시 일정 확률로 진노(1페이즈 추가), 격노마다 대미지 5% 추가 중첩',
    slot: 'item',
    cost: 200,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: false,
    getWarPowerMultiplier: (_context, unit, _oppose) => {
        const activatedCnt = unit.hasActivatedSkillOnLog('격노');
        return [1 + 0.05 * activatedCnt, 1];
    },
    getBattlePhaseTriggerList: (context) => {
        if (!context.unit) return null;
        return new WarTriggerCaller(
            new CheRageAttemptTrigger(context.unit, BaseWarUnitTrigger.TYPE_ITEM),
            new CheRageActivateTrigger(context.unit, BaseWarUnitTrigger.TYPE_ITEM)
        );
    },
};
