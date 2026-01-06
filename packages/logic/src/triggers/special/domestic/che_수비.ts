import { TraitRequirement, TraitWeightType } from '@sammo-ts/logic/triggers/special/requirements.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 내정 특기: 수비
export const traitModule: TraitModule = {
    key: 'che_수비',
    name: '수비',
    info: '[내정] 수비 강화 : 기본 보정 +10%, 성공률 +10%p, 비용 -20%',
    kind: 'domestic',
    selection: {
        requirements: [TraitRequirement.STAT_STRENGTH],
        weight: 1,
        weightType: TraitWeightType.NORM,
    },
    getName: () => '수비',
    getInfo: () => '[내정] 수비 강화 : 기본 보정 +10%, 성공률 +10%p, 비용 -20%',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '수비') {
            if (varType === 'score') {
                return value * 1.1;
            }
            if (varType === 'cost') {
                return value * 0.8;
            }
            if (varType === 'success') {
                return value + 0.1;
            }
        }
        return value;
    },
};
