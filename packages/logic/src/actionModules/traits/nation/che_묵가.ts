import type { TraitModule } from '@sammo-ts/logic/actionModules/traits/types.js';

// 국가 성향: 묵가
export const traitModule: TraitModule = {
    key: 'che_묵가',
    name: '묵가',
    info: '수성↑ 기술↓',
    kind: 'nation',
    getName: () => '묵가',
    getInfo: () => '수성↑ 기술↓',
    onCalcDomestic: (_context, turnType, varType, value) => {
        if (turnType === '수비' || turnType === '성벽') {
            if (varType === 'score') return value * 1.1;
            if (varType === 'cost') return value * 0.8;
        } else if (turnType === '기술') {
            if (varType === 'score') return value * 0.9;
            if (varType === 'cost') return value * 1.2;
        }
        return value;
    },
};
