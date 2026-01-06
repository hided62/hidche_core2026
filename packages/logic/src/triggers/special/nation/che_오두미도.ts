import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 국가 성향: 오두미도
export const traitModule: TraitModule = {
    key: 'che_오두미도',
    name: '오두미도',
    info: '장점: 쌀수입↑ 인구↑ / 단점: 기술↓ 수성↓ 농상↓',
    kind: 'nation',
    getName: () => '오두미도',
    getInfo: () => '장점: 쌀수입↑ 인구↑ / 단점: 기술↓ 수성↓ 농상↓',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (
            turnType === '기술' ||
            turnType === '수비' ||
            turnType === '성벽' ||
            turnType === '농업' ||
            turnType === '상업'
        ) {
            if (varType === 'score') return value * 0.9;
            if (varType === 'cost') return value * 1.2;
        }
        return value;
    },
    onCalcNationalIncome: (_context, type, amount) => {
        if (type === 'rice') return amount * 1.1;
        if (type === 'pop' && amount > 0) return amount * 1.2;
        return amount;
    },
};
