import { describe, expect, it } from 'vitest';

import { toSafeInteger, withSafeIntegerId } from '../src/util/parse.js';

describe('exact numeric ID transport', () => {
    it('preserves IDs above int4 through the maximum exact JS integer', () => {
        expect(toSafeInteger(2_147_483_648n)).toBe(2_147_483_648);
        expect(toSafeInteger(9_007_199_254_740_991n)).toBe(Number.MAX_SAFE_INTEGER);
        expect(withSafeIntegerId({ id: 2_147_483_648n, text: 'record' })).toEqual({
            id: 2_147_483_648,
            text: 'record',
        });
    });

    it('rejects silent precision loss, fractional and nonfinite IDs', () => {
        for (const value of [9_007_199_254_740_992n, 9_007_199_254_740_993n, 1.5, NaN, Infinity]) {
            expect(() => toSafeInteger(value)).toThrow(RangeError);
        }
    });
});
