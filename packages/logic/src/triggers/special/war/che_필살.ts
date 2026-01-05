import type { TraitOnCalcStat, TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import type { WarUnit } from '@sammo-ts/logic/war/units.js';

class che_필살강화_회피불가 extends BaseWarUnitTrigger {
    constructor(unit: WarUnit) {
        super(unit, 20150);
    }

    protected actionWar(
        self: WarUnit,
        oppose: WarUnit,
        _selfEnv: Record<string, unknown>,
        _opposeEnv: Record<string, unknown>
    ): boolean {
        if (!self.hasActivatedSkill('필살')) {
            return true;
        }

        oppose.activateSkill('회피불가');
        return true;
    }
}

const onCalcStat = ((
    _context: GeneralActionContext | WarActionContext,
    statName: GeneralStatName | WarStatName,
    value: number | [number, number],
    _aux?: unknown
): number | [number, number] => {
    if (statName === 'warCriticalRatio' && typeof value === 'number') {
        return value + 0.3;
    }
    if (statName === 'criticalDamageRange' && Array.isArray(value)) {
        const [rangeMin, rangeMax] = value;
        return [(rangeMin + rangeMax) / 2, rangeMax];
    }
    return value;
}) as unknown as TraitOnCalcStat;

export const traitModule: TraitModule = {
    key: 'che_필살',
    name: '필살',
    info: '[전투] 필살 확률 +30%p, 필살 발동시 대상 회피 불가, 필살 계수 향상',
    kind: 'war',
    getName: () => '필살',
    getInfo: () => '[전투] 필살 확률 +30%p, 필살 발동시 대상 회피 불가, 필살 계수 향상',
    getBattlePhaseTriggerList: (_context) => {
        if (!_context.unit) return null;
        return new WarTriggerCaller(new che_필살강화_회피불가(_context.unit));
    },
    onCalcStat,
};
