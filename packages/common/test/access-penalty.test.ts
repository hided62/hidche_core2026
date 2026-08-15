import { describe, expect, it } from 'vitest';

import {
    calculateAccessRefreshLimit,
    resolveAccessLimitLevel,
    resolveAccessRefreshLimit,
} from '../src/game/accessPenalty.js';

describe('legacy access penalty', () => {
    it.each([
        [60, 30],
        [300, 80],
        [600, 120],
        [1_200, 180],
    ])('calculates the Ref refresh limit for %i-second turns', (tickSeconds, expected) => {
        expect(calculateAccessRefreshLimit(tickSeconds)).toBe(expected);
    });

    it('keeps a persisted positive limit and derives a missing one', () => {
        expect(resolveAccessRefreshLimit(600, 777)).toBe(777);
        expect(resolveAccessRefreshLimit(600, undefined)).toBe(120);
        expect(resolveAccessRefreshLimit(600, 0)).toBe(120);
    });

    it('uses the strict Ref threshold and warns only above ninety percent', () => {
        expect(resolveAccessLimitLevel(108, 120)).toBe(0);
        expect(resolveAccessLimitLevel(109, 120)).toBe(1);
        expect(resolveAccessLimitLevel(120, 120)).toBe(1);
        expect(resolveAccessLimitLevel(121, 120)).toBe(2);
    });
});
