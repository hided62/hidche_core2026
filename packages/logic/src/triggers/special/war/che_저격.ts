import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { TraitRequirement, TraitWeightType } from '../requirements.js';
import { BaseWarUnitTrigger, WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_저격발동, che_저격시도 } from '@sammo-ts/logic/war/triggers/che_저격.js';

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
    key: 'che_저격',
    name: '저격',
    info: '[전투] 새로운 상대와 전투 시 50% 확률로 저격 발동, 성공 시 사기+20',
    kind: 'war',
    getName: () => '저격',
    getInfo: () => '[전투] 새로운 상대와 전투 시 50% 확률로 저격 발동, 성공 시 사기+20',
    selection: {
        requirements: [TraitRequirement.STAT_LEADERSHIP, TraitRequirement.STAT_STRENGTH, TraitRequirement.STAT_INTEL],
        weight: 1,
        weightType: TraitWeightType.NORM,
    },
    getBattlePhaseTriggerList: (_context) => {
        if (!_context.unit) return null;
        return new WarTriggerCaller(
            new che_저격시도(_context.unit, BaseWarUnitTrigger.TYPE_NONE, 0.5, 20, 40, 20),
            new che_저격발동(_context.unit, BaseWarUnitTrigger.TYPE_NONE)
        );
    },
    onCalcStat,
};
