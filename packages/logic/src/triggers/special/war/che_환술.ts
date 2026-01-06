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
    if (statName === 'warMagicSuccessProb') {
        return (value as number) + 0.1;
    }
    if (statName === 'warMagicSuccessDamage') {
        return (value as number) * 1.3;
    }
    return value;
}

export const traitModule: TraitModule = {
    key: 'che_환술',
    name: '환술',
    info: '[전투] 계략 성공 확률 +10%p, 계략 성공 시 대미지 +30%',
    kind: 'war',
    getName: () => '환술',
    getInfo: () => '[전투] 계략 성공 확률 +10%p, 계략 성공 시 대미지 +30%',
    selection: {
        requirements: [TraitRequirement.STAT_INTEL],
        weight: 5,
        weightType: TraitWeightType.PERCENT,
    },
    onCalcStat,
};
