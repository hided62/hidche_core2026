import { describe, expect, it } from 'vitest';

import { round } from '../src/war/utils.js';

describe('war rounding', () => {
    it('uses the native number boundary without half-point correction', () => {
        expect(round(4159.499999999999)).toBe(4159);
        expect(round(-4159.499999999999)).toBe(-4159);
        expect(round(8719.4999999999945)).toBe(8719);
        expect(round(-8719.4999999999945)).toBe(-8719);
    });

    it('keeps values meaningfully below a half boundary on the lower integer', () => {
        expect(round(4159.499999)).toBe(4159);
        expect(round(-4159.499999)).toBe(-4159);
    });

    it('uses JavaScript semantics at exact half points', () => {
        expect(round(1.5)).toBe(2);
        expect(round(-1.5)).toBe(-1);
    });
});
