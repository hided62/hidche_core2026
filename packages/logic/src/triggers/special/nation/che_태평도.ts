import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 국가 성향: 태평도
export const traitModule: TraitModule = {
    key: 'che_태평도',
    name: '태평도',
    info: '장점: 인구↑ 민심↑ / 단점: 기술↓ 수성↓',
    kind: 'nation',
    getName: () => '태평도',
    getInfo: () => '장점: 인구↑ 민심↑ / 단점: 기술↓ 수성↓',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '민심' || turnType === '인구') {
            if (varType === 'score') return value * 1.1;
            if (varType === 'cost') return value * 0.8;
        } else if (turnType === '기술' || turnType === '수비' || turnType === '성벽') {
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
