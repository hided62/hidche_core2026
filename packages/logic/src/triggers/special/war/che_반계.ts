import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { TraitRequirement, TraitWeightType } from '../requirements.js';
import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_반계발동, che_반계시도 } from '@sammo-ts/logic/war/triggers/che_반계.js';

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
    aux?: unknown
): number | [number, number] {
    if (statName === 'warMagicSuccessDamage' && aux === '반목') {
        return (value as number) + 0.9;
    }
    return value;
}

export const traitModule: TraitModule = {
    key: 'che_반계',
    name: '반계',
    info: '[전투] 상대의 계략 성공 확률 -10%p, 상대의 계략을 40% 확률로 되돌림, 반목 성공시 대미지 추가(+60% → +150%)',
    kind: 'war',
    getName: () => '반계',
    getInfo: () =>
        '[전투] 상대의 계략 성공 확률 -10%p, 상대의 계략을 40% 확률로 되돌림, 반목 성공시 대미지 추가(+60% → +150%)',
    selection: {
        requirements: [TraitRequirement.STAT_INTEL],
        weight: 1,
        weightType: TraitWeightType.NORM,
    },
    onCalcOpposeStat: ((_context, statName, value, _aux) => {
        if (statName === 'warMagicSuccessProb' && typeof value === 'number') {
            return value - 0.1;
        }
        return value;
    }) as TraitModule['onCalcOpposeStat'],
    getBattlePhaseTriggerList: (_context) => {
        if (!_context.unit) return null;
        return new WarTriggerCaller(new che_반계시도(_context.unit), new che_반계발동(_context.unit));
    },
    onCalcStat,
};
