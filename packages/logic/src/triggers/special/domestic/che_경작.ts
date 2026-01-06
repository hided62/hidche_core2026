import { TraitRequirement, TraitWeightType } from '@sammo-ts/logic/triggers/special/requirements.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 내정 특기: 경작
export const traitModule: TraitModule = {
    key: 'che_경작',
    name: '경작',
    info: '[내정] 농지 개간 : 기본 보정 +10%, 성공률 +10%p, 비용 -20%',
    kind: 'domestic',
    selection: {
        requirements: [TraitRequirement.STAT_INTEL],
        weight: 1,
        weightType: TraitWeightType.NORM,
    },
    getName: () => '경작',
    getInfo: () => '[내정] 농지 개간 : 기본 보정 +10%, 성공률 +10%p, 비용 -20%',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '농업') {
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
