import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 국가 성향: 음양가
export const traitModule: TraitModule = {
    key: 'che_음양가',
    name: '음양가',
    info: '장점: 농상↑ 인구↑ / 단점: 기술↓ 전략↓',
    kind: 'nation',
    getName: () => '음양가',
    getInfo: () => '장점: 농상↑ 인구↑ / 단점: 기술↓ 전략↓',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '농업' || turnType === '상업') {
            if (varType === 'score') return value * 1.1;
            if (varType === 'cost') return value * 0.8;
        } else if (turnType === '기술') {
            if (varType === 'score') return value * 0.9;
            if (varType === 'cost') return value * 1.2;
        }
        return value;
    },
    onCalcNationalIncome: (_context, type, amount) => {
        if (type === 'pop' && amount > 0) return amount * 1.2;
        return amount;
    },
    onCalcStrategic: (_context, _turnType, varType, value) => {
        if (varType === 'delay') {
            return Math.round((value * 4) / 3);
        }
        return value;
    },
};
