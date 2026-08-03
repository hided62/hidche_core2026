import { describe, expect, it } from 'vitest';

import { round } from '../src/war/utils.js';

describe('legacy war rounding', () => {
    it('matches PHP round() at drifted positive and negative half boundaries', () => {
        expect(round(4159.499999999999)).toBe(4160);
        expect(round(-4159.499999999999)).toBe(-4160);
    });

    it('keeps values meaningfully below a half boundary on the lower integer', () => {
        expect(round(4159.499999)).toBe(4159);
        expect(round(-4159.499999)).toBe(-4159);
    });
});
