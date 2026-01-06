import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 국가 성향: 불가
export const traitModule: TraitModule = {
    key: 'che_불가',
    name: '불가',
    info: '장점: 민심↑ 수성↑ / 단점: 금수입↓',
    kind: 'nation',
    getName: () => '불가',
    getInfo: () => '장점: 민심↑ 수성↑ / 단점: 금수입↓',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '민심' || turnType === '인구' || turnType === '수비' || turnType === '성벽') {
            if (varType === 'score') return value * 1.1;
            if (varType === 'cost') return value * 0.8;
        }
        return value;
    },
    onCalcNationalIncome: (_context, type, amount) => {
        if (type === 'gold') return amount * 0.9;
        return amount;
    },
};
