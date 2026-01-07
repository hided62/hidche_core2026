import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { TraitRequirement, TraitWeightType } from '../requirements.js';
import { WarTriggerCaller } from '@sammo-ts/logic/war/triggers.js';
import { che_격노발동, che_격노시도 } from '@sammo-ts/logic/war/triggers/che_격노.js';

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
    key: 'che_격노',
    name: '격노',
    info: '[전투] 상대방 필살 시 격노(필살) 발동, 회피 시도시 25% 확률로 격노 발동, 공격 시 일정 확률로 진노(1페이즈 추가), 격노마다 대미지 20% 추가 중첩',
    kind: 'war',
    getName: () => '격노',
    getInfo: () =>
        '[전투] 상대방 필살 시 격노(필살) 발동, 회피 시도시 25% 확률로 격노 발동, 공격 시 일정 확률로 진노(1페이즈 추가), 격노마다 대미지 20% 추가 중첩',
    selection: {
        requirements: [TraitRequirement.STAT_STRENGTH],
        weight: 1,
        weightType: TraitWeightType.NORM,
    },
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
