import type { TraitModule } from '@sammo-ts/logic/triggers/special/types.js';

// 국가 성향: 중립
export const traitModule: TraitModule = {
    key: 'che_중립',
    name: '중립',
    info: '장점: 없음 / 단점: 없음',
    kind: 'nation',
    getName: () => '중립',
    getInfo: () => '장점: 없음 / 단점: 없음',
};
