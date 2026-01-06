import { TraitRequirement, TraitWeightType } from '@sammo-ts/logic/triggers/special/requirements.js';
import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 내정 특기: 귀모
export const traitModule: TraitModule = {
    key: 'che_귀모',
    name: '귀모',
    info: '[계략] 화계·탈취·파괴·선동 : 성공률 +20%p',
    kind: 'domestic',
    selection: {
        requirements: [TraitRequirement.STAT_LEADERSHIP, TraitRequirement.STAT_STRENGTH, TraitRequirement.STAT_INTEL],
        weight: 2.5,
        weightType: TraitWeightType.PERCENT,
    },
    getName: () => '귀모',
    getInfo: () => '[계략] 화계·탈취·파괴·선동 : 성공률 +20%p',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '계략') {
            if (varType === 'success') {
                return value + 0.2;
            }
        }
        return value;
    },
};
