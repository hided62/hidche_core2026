import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 국가 성향: 유가
export const traitModule: TraitModule = {
    key: 'che_유가',
    name: '유가',
    info: '장점: 농상↑ 민심↑ / 단점: 쌀수입↓',
    kind: 'nation',
    getName: () => '유가',
    getInfo: () => '장점: 농상↑ 민심↑ / 단점: 쌀수입↓',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '농업' || turnType === '상업' || turnType === '민심' || turnType === '인구') {
            if (varType === 'score') return value * 1.1;
            if (varType === 'cost') return value * 0.8;
        }
        return value;
    },
    onCalcNationalIncome: (_context, type, amount) => {
        if (type === 'rice') return amount * 0.9;
        return amount;
    },
};
