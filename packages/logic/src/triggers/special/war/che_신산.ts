import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { TraitRequirement, TraitWeightType } from '../requirements.js';

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
    if (statName === 'warMagicTrialProb') {
        return (value as number) + 0.2;
    }
    if (statName === 'warMagicSuccessProb') {
        return (value as number) + 0.2;
    }
    return value;
}

export const traitModule: TraitModule = {
    key: 'che_신산',
    name: '신산',
    info: '[계략] 화계·탈취·파괴·선동 : 성공률 +10%p<br>[전투] 계략 시도 확률 +20%p, 계략 성공 확률 +20%p',
    kind: 'war',
    getName: () => '신산',
    getInfo: () => '[계략] 화계·탈취·파괴·선동 : 성공률 +10%p<br>[전투] 계략 시도 확률 +20%p, 계략 성공 확률 +20%p',
    selection: {
        requirements: [TraitRequirement.STAT_INTEL],
        weight: 1,
        weightType: TraitWeightType.NORM,
    },
    onCalcDomestic: (_context, turnType, varType, value, _aux) => {
        if (turnType === '계략') {
            if (varType === 'success') return value + 0.1;
        }
        return value;
    },
    onCalcStat,
};
