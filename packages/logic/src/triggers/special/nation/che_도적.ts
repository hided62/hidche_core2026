import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 국가 성향: 도적
export const traitModule: TraitModule = {
    key: 'che_도적',
    name: '도적',
    info: '장점: 계략↑ / 단점: 금수입↓ 치안↓ 민심↓',
    kind: 'nation',
    getName: () => '도적',
    getInfo: () => '장점: 계략↑ / 단점: 금수입↓ 치안↓ 민심↓',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '치안' || turnType === '민심' || turnType === '인구') {
            if (varType === 'score') return value * 0.9;
            if (varType === 'cost') return value * 1.2;
        } else if (turnType === '계략') {
            if (varType === 'success') return value + 0.1;
        }
        return value;
    },
    onCalcNationalIncome: (_context, type, amount) => {
        if (type === 'gold') return amount * 0.9;
        return amount;
    },
};
