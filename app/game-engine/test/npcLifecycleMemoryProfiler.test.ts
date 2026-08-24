import { describe, expect, it } from 'vitest';

import { linearRegressionSlope } from './helpers/npcLifecycleMemoryProfiler.js';

describe('NPC lifecycle memory profiler metrics', () => {
    it('calculates the retained-byte slope from unevenly spaced samples', () => {
        expect(
            linearRegressionSlope([
                { x: 0, y: 100 },
                { x: 2, y: 140 },
                { x: 5, y: 200 },
            ])
        ).toBeCloseTo(20, 8);
    });

    it('returns zero when a trend cannot be established', () => {
        expect(linearRegressionSlope([])).toBe(0);
        expect(linearRegressionSlope([{ x: 1, y: 10 }])).toBe(0);
    });
});
