import { describe, expect, it } from 'vitest';

import { calculateCancelledInheritancePoint } from '../src/scenario/gameCancellation.js';

describe('cancelled game inheritance settlement', () => {
    it('refunds every spent point and discards earned points at zero percent', () => {
        expect(
            calculateCancelledInheritancePoint({
                openingPoint: 10_000,
                earnedPoint: 2_345.75,
                earnedPointRetentionPercent: 0,
            })
        ).toEqual({ retainedEarnedPoint: 0, finalPoint: 10_000 });
    });

    it('retains the selected integer percentage without rounding upward', () => {
        expect(
            calculateCancelledInheritancePoint({
                openingPoint: 10_000,
                earnedPoint: 333,
                earnedPointRetentionPercent: 50,
            })
        ).toEqual({ retainedEarnedPoint: 166, finalPoint: 10_166 });
    });

    it('retains all earned points at one hundred percent', () => {
        expect(
            calculateCancelledInheritancePoint({
                openingPoint: 10_000,
                earnedPoint: 333,
                earnedPointRetentionPercent: 100,
            })
        ).toEqual({ retainedEarnedPoint: 333, finalPoint: 10_333 });
    });

    it.each([-1, 1.5, 101])('rejects invalid retention percentage %s', (earnedPointRetentionPercent) => {
        expect(() =>
            calculateCancelledInheritancePoint({
                openingPoint: 0,
                earnedPoint: 0,
                earnedPointRetentionPercent,
            })
        ).toThrow('integer from 0 to 100');
    });
});
