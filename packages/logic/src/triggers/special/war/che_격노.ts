import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';
import { LogFormat } from '@sammo-ts/logic/logging/types.js';

class che_격노시도 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, 30400);
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

class che_격노발동 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, 40600);
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
        oppose.getLogger().pushGeneralBattleDetailLog(`${targetAct}에 상대가 <R>${reaction}</>했다!</>`, LogFormat.PLAIN);

        if (is진노) {
            self.addBonusPhase(1);
        }
        self.multiplyWarPowerMultiply(self.criticalDamage());

        return true;
    }
}

function onCalcStat(context: GeneralActionContext, statName: GeneralStatName, value: number, aux?: unknown): number;
function onCalcStat(
    context: WarActionContext,
    statName: WarStatName,
    value: number | [number, number],
    aux?: unknown
): number | [number, number];
function onCalcStat(
    context: GeneralActionContext | WarActionContext,
    statName: GeneralStatName | WarStatName,
    value: number | [number, number],
    aux?: unknown
): number | [number, number] {
    return value;
}

export const traitModule: TraitModule = {
    key: 'che_격노',
    name: '격노',
    info: '[전투] 상대방 필살 시 격노(필살) 발동, 회피 시도시 25% 확률로 격노 발동, 공격 시 일정 확률로 진노(1페이즈 추가), 격노마다 대미지 20% 추가 중첩',
    kind: 'war',
    getName: () => '격노',
    getInfo: () =>
        '[전투] 상대방 필살 시 격노(필살) 발동, 회피 시도시 25% 확률로 격노 발동, 공격 시 일정 확률로 진노(1페이즈 추가), 격노마다 대미지 20% 추가 중첩',
    getWarPowerMultiplier: (_context, unit, _oppose) => {
        const activatedCnt = unit.hasActivatedSkillOnLog('격노');
        return [1 + 0.2 * activatedCnt, 1];
    },
    getBattlePhaseTriggerList: (_context) => {
        if (!_context.unit) return null;
        return new WarTriggerCaller(new che_격노시도(_context.unit), new che_격노발동(_context.unit));
    },
    onCalcStat,
};
