import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { TraitRequirement, TraitWeightType } from '../requirements.js';
import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_필살강화_회피불가 } from '@sammo-ts/logic/war/triggers/che_필살.js';

function onCalcStat(context: GeneralActionContext, statName: GeneralStatName, value: number, aux?: unknown): number;
function onCalcStat(
    context: WarActionContext,
    statName: WarStatName,
    value: number | [number, number],
    aux?: unknown
): number | [number, number];
function onCalcStat(
    _context: GeneralActionContext | WarActionContext,
    statName: GeneralStatName | WarStatName,
    value: number | [number, number],
    _aux?: unknown
): number | [number, number] {
    if (statName === 'warCriticalRatio') {
        return (value as number) + 0.3;
    }
    if (statName === 'criticalDamageRange') {
        const [rangeMin, rangeMax] = value as [number, number];
        return [(rangeMin + rangeMax) / 2, rangeMax];
    }
    return value;
}

export const traitModule: TraitModule = {
    key: 'che_필살',
    name: '필살',
    info: '[전투] 필살 확률 +30%p, 필살 발동시 대상 회피 불가, 필살 계수 향상',
    kind: 'war',
    getName: () => '필살',
    getInfo: () => '[전투] 필살 확률 +30%p, 필살 발동시 대상 회피 불가, 필살 계수 향상',
    selection: {
        requirements: [TraitRequirement.STAT_LEADERSHIP, TraitRequirement.STAT_STRENGTH, TraitRequirement.STAT_INTEL],
        weight: 1,
        weightType: TraitWeightType.NORM,
    },
    getBattlePhaseTriggerList: (_context) => {
        if (!_context.unit) return null;
        return new WarTriggerCaller(new che_필살강화_회피불가(_context.unit));
    },
    onCalcStat,
};
