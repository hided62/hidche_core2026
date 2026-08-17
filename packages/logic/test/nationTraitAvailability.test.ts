import { describe, expect, it } from 'vitest';

import {
    AVAILABLE_NATION_TRAIT_KEYS,
    isAvailableNationTraitKey,
    NATION_TRAIT_KEYS,
} from '../src/actionModules/traits/nation/index.js';

describe('Ref-selectable nation traits', () => {
    it('keeps the neutral storage trait valid internally but unavailable to user selection', () => {
        expect(NATION_TRAIT_KEYS).toContain('che_중립');
        expect(AVAILABLE_NATION_TRAIT_KEYS).toEqual([
            'che_도적',
            'che_명가',
            'che_음양가',
            'che_종횡가',
            'che_불가',
            'che_오두미도',
            'che_태평도',
            'che_도가',
            'che_묵가',
            'che_덕가',
            'che_병가',
            'che_유가',
            'che_법가',
        ]);
        expect(isAvailableNationTraitKey('che_중립')).toBe(false);
        expect(isAvailableNationTraitKey('che_도적')).toBe(true);
    });
});
