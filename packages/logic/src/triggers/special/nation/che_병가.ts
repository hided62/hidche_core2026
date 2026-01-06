import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 국가 성향: 병가
export const traitModule: TraitModule = {
    key: 'che_병가',
    name: '병가',
    info: '장점: 기술↑ 수성↑ / 단점: 인구↓ 민심↓',
    kind: 'nation',
    getName: () => '병가',
    getInfo: () => '장점: 기술↑ 수성↑ / 단점: 인구↓ 민심↓',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '기술' || turnType === '수비' || turnType === '성벽') {
            if (varType === 'score') return value * 1.1;
            if (varType === 'cost') return value * 0.8;
        } else if (turnType === '민심' || turnType === '인구') {
            if (varType === 'score') return value * 0.9;
            if (varType === 'cost') return value * 1.2;
        }
        return value;
    },
    onCalcNationalIncome: (_context, type, amount) => {
        if (type === 'pop' && amount > 0) return amount * 0.8;
        return amount;
    },
};
