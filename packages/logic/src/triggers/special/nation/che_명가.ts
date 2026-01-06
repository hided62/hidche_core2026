import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 국가 성향: 명가
export const traitModule: TraitModule = {
    key: 'che_명가',
    name: '명가',
    info: '장점: 기술↑ 인구↑ / 단점: 쌀수입↓ 수성↓',
    kind: 'nation',
    getName: () => '명가',
    getInfo: () => '장점: 기술↑ 인구↑ / 단점: 쌀수입↓ 수성↓',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '기술') {
            if (varType === 'score') return value * 1.1;
            if (varType === 'cost') return value * 0.8;
        } else if (turnType === '수비' || turnType === '성벽') {
            if (varType === 'score') return value * 0.9;
            if (varType === 'cost') return value * 1.2;
        }
        return value;
    },
    onCalcNationalIncome: (_context, type, amount) => {
        if (type === 'rice') return amount * 0.9;
        if (type === 'pop' && amount > 0) return amount * 1.2;
        return amount;
    },
};
