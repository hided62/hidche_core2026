import { TraitRequirement, TraitWeightType } from '@sammo-ts/logic/triggers/special/requirements.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 내정 특기: 인덕
export const traitModule: TraitModule = {
    key: 'che_인덕',
    name: '인덕',
    info: '[내정] 주민 선정·정착 장려 : 기본 보정 +10%, 성공률 +10%p, 비용 -20%',
    kind: 'domestic',
    selection: {
        requirements: [TraitRequirement.STAT_LEADERSHIP],
        weight: 1,
        weightType: TraitWeightType.NORM,
    },
    getName: () => '인덕',
    getInfo: () => '[내정] 주민 선정·정착 장려 : 기본 보정 +10%, 성공률 +10%p, 비용 -20%',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '민심' || turnType === '인구') {
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
