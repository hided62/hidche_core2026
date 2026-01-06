import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 국가 성향: 종횡가
export const traitModule: TraitModule = {
    key: 'che_종횡가',
    name: '종횡가',
    info: '장점: 전략↑ 수성↑ / 단점: 금수입↓ 농상↓',
    kind: 'nation',
    getName: () => '종횡가',
    getInfo: () => '장점: 전략↑ 수성↑ / 단점: 금수입↓ 농상↓',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '수비' || turnType === '성벽') {
            if (varType === 'score') return value * 1.1;
            if (varType === 'cost') return value * 0.8;
        } else if (turnType === '농업' || turnType === '상업') {
            if (varType === 'score') return value * 0.9;
            if (varType === 'cost') return value * 1.2;
        }
        return value;
    },
    onCalcNationalIncome: (_context, type, amount) => {
        if (type === 'gold') return amount * 0.9;
        return amount;
    },
    onCalcStrategic: (_context, _turnType, varType, value) => {
        if (varType === 'delay') {
            return Math.round((value * 3) / 4);
        }
        if (varType === 'globalDelay') {
            return Math.round(value / 2);
        }
        return value;
    },
};
