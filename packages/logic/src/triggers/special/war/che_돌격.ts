import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

class che_돌격지속 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, 40900);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
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
    if (statName === 'initWarPhase') {
        return (value as number) + 2;
    }
    return value;
}

export const traitModule: TraitModule = {
    key: 'che_돌격',
    name: '돌격',
    info: '[전투] 공격 시 대등/유리한 병종에게는 퇴각 전까지 전투, 공격 시 페이즈 + 2, 공격 시 대미지 +5%',
    kind: 'war',
    getName: () => '돌격',
    getInfo: () => '[전투] 공격 시 대등/유리한 병종에게는 퇴각 전까지 전투, 공격 시 페이즈 + 2, 공격 시 대미지 +5%',
    getWarPowerMultiplier: (_context, unit, _oppose) => {
        if (unit.isAttacker()) {
            return [1.05, 1];
        }
        return [1, 1];
    },
    getBattlePhaseTriggerList: (_context) => {
        if (!_context.unit) return null;
        return new WarTriggerCaller(new che_돌격지속(_context.unit));
    },
    onCalcStat,
};
