import type { GeneralActionContext } from '@sammo-ts/logic/triggers/general.js';
import type { GeneralStatName, WarStatName } from '@sammo-ts/logic/triggers/types.js';
import type { WarActionContext } from '@sammo-ts/logic/war/actions.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';
import { TraitRequirement, TraitWeightType } from '../requirements.js';

const RECRUIT_TRAIN = 70;
const CONSCRIPT_TRAIN = 84;

const resolveLeadershipBonus = (
    context: GeneralActionContext | WarActionContext,
    value: number | [number, number]
): number | [number, number] => {
    if (Array.isArray(value)) {
        return value;
    }
    const base = context.general.stats.leadership;
    return value + base * 0.25;
};

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
    value: number | [number, number]
): number | [number, number] {
    if (statName !== 'leadership') {
        return value;
    }
    return resolveLeadershipBonus(context, value);
}

// 전투 특기: 징병
export const traitModule: TraitModule = {
    key: 'che_징병',
    name: '징병',
    info: '[군사] 징병/모병 시 훈사 70/84 제공<br>[기타] 통솔 순수 능력치 보정 +25%, 징병/모병/소집해제 시 인구 변동 없음',
    kind: 'war',
    getName: () => '징병',
    getInfo: () =>
        '[군사] 징병/모병 시 훈사 70/84 제공<br>[기타] 통솔 순수 능력치 보정 +25%, 징병/모병/소집해제 시 인구 변동 없음',
    selection: {
        requirements: [TraitRequirement.STAT_LEADERSHIP, TraitRequirement.STAT_STRENGTH, TraitRequirement.STAT_INTEL],
        weight: 1,
        weightType: TraitWeightType.NORM,
    },
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '징병' || turnType === '모병') {
            if (varType === 'train' || varType === 'atmos') {
                return turnType === '징병' ? RECRUIT_TRAIN : CONSCRIPT_TRAIN;
            }
        }
        if (turnType === '징집인구' && varType === 'score') {
            return 0;
        }
        return value;
    },
    onCalcStat,
};
