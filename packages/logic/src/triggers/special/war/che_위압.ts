import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { TraitRequirement, TraitWeightType } from '../requirements.js';
import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_위압발동, che_위압시도 } from '@sammo-ts/logic/war/triggers/che_위압.js';

function onCalcStat(context: GeneralActionContext, statName: GeneralStatName, value: number, aux?: unknown): number;
function onCalcStat(
    context: WarActionContext,
    statName: WarStatName,
    value: number | [number, number],
    aux?: unknown
): number | [number, number];
function onCalcStat(
    _context: GeneralActionContext | WarActionContext,
    _statName: GeneralStatName | WarStatName,
    value: number | [number, number],
    _aux?: unknown
): number | [number, number] {
    return value;
}

export const traitModule: TraitModule = {
    key: 'che_위압',
    name: '위압',
    info: '[전투] 첫 페이즈 위압 발동(적 공격, 회피 불가, 사기 5 감소)',
    kind: 'war',
    getName: () => '위압',
    getInfo: () => '[전투] 첫 페이즈 위압 발동(적 공격, 회피 불가, 사기 5 감소)',
    selection: {
        requirements: [TraitRequirement.STAT_STRENGTH],
        weight: 1,
        weightType: TraitWeightType.NORM,
    },
    getBattlePhaseTriggerList: (_context) => {
        if (!_context.unit) return null;
        return new WarTriggerCaller(new che_위압시도(_context.unit), new che_위압발동(_context.unit));
    },
    onCalcStat,
};
