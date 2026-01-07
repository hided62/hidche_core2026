import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { TraitRequirement, TraitWeightType } from '../requirements.js';
import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_부상무효 } from '@sammo-ts/logic/war/triggers/che_견고.js';

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
    key: 'che_견고',
    name: '견고',
    info: '[전투] 상대 필살 확률 -20%p, 상대 계략 시도시 성공 확률 -10%p, 부상 없음, 아군 피해 -10%',
    kind: 'war',
    getName: () => '견고',
    getInfo: () => '[전투] 상대 필살 확률 -20%p, 상대 계략 시도시 성공 확률 -10%p, 부상 없음, 아군 피해 -10%',
    selection: {
        requirements: [TraitRequirement.STAT_STRENGTH],
        weight: 1,
        weightType: TraitWeightType.NORM,
    },
    onCalcOpposeStat: ((_context, statName, value, _aux) => {
        if (statName === 'warMagicSuccessProb' && typeof value === 'number') {
            return value - 0.1;
        }
        if (statName === 'warCriticalRatio' && typeof value === 'number') {
            return value - 0.2;
        }
        return value;
    }) as TraitModule['onCalcOpposeStat'],
    getBattleInitTriggerList: (_context) => {
        if (!_context.unit) return null;
        return new WarTriggerCaller(new che_부상무효(_context.unit));
    },
    getBattlePhaseTriggerList: (_context) => {
        if (!_context.unit) return null;
        return new WarTriggerCaller(new che_부상무효(_context.unit));
    },
    getWarPowerMultiplier: (_context, _unit, _oppose) => {
        return [1, 0.9];
    },
    onCalcStat,
};
