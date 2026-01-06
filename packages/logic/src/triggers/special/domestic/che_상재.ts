import { TraitRequirement, TraitWeightType } from '@sammo-ts/logic/triggers/special/requirements.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 내정 특기: 상재
export const traitModule: TraitModule = {
    key: 'che_상재',
    name: '상재',
    info: '[내정] 상업 투자 : 기본 보정 +10%, 성공률 +10%p, 비용 -20%',
    kind: 'domestic',
    selection: {
        requirements: [TraitRequirement.STAT_INTEL],
        weight: 1,
        weightType: TraitWeightType.NORM,
    },
    getName: () => '상재',
    getInfo: () => '[내정] 상업 투자 : 기본 보정 +10%, 성공률 +10%p, 비용 -20%',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '상업') {
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
