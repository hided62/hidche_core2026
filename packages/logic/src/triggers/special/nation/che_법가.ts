import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 국가 성향: 법가
export const traitModule: TraitModule = {
    key: 'che_법가',
    name: '법가',
    info: '장점: 금수입↑ 치안↑ / 단점: 인구↓ 민심↓',
    kind: 'nation',
    getName: () => '법가',
    getInfo: () => '장점: 금수입↑ 치안↑ / 단점: 인구↓ 민심↓',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '치안') {
            if (varType === 'score') return value * 1.1;
            if (varType === 'cost') return value * 0.8;
        } else if (turnType === '민심' || turnType === '인구') {
            if (varType === 'score') return value * 0.9;
            if (varType === 'cost') return value * 1.2;
        }
        return value;
    },
    onCalcNationalIncome: (_context, type, amount) => {
        if (type === 'gold') return amount * 1.1;
        if (type === 'pop' && amount > 0) return amount * 0.8;
        return amount;
    },
};
