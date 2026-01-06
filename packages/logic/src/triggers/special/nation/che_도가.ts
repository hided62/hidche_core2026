import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 국가 성향: 도가
export const traitModule: TraitModule = {
    key: 'che_도가',
    name: '도가',
    info: '장점: 인구↑ / 단점: 기술↓ 치안↓',
    kind: 'nation',
    getName: () => '도가',
    getInfo: () => '장점: 인구↑ / 단점: 기술↓ 치안↓',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '기술' || turnType === '치안') {
            if (varType === 'score') return value * 0.9;
            if (varType === 'cost') return value * 1.2;
        }
        return value;
    },
    onCalcNationalIncome: (_context, type, amount) => {
        if (type === 'pop' && amount > 0) return amount * 1.2;
        return amount;
    },
};
