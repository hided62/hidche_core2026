import { describe, expect, it } from 'vitest';

import { resolveResetTurnTimeBase } from '../src/router/inherit/index.js';

describe('inherit reset turn time Ref compatibility', () => {
    it('matches the Ref PHP deterministic seed, offset, and displayed minute', () => {
        const result = resolveResetTurnTimeBase({
            hiddenSeed: 'hidden-seed',
            userId: 'user-7',
            previousTurnTimeBase: 123_456,
            tickSeconds: 600,
        });

        expect(result.nextTurnTimeBase).toBeCloseTo(302.5143852464758, 12);
        expect(result.nextTurnTimeLabel).toBe('00:05');
    });

    it('uses the prior pending base as the next deterministic seed input', () => {
        const first = resolveResetTurnTimeBase({
            hiddenSeed: 'hidden-seed',
            userId: 'user-7',
            previousTurnTimeBase: 123_456,
            tickSeconds: 600,
        });
        const second = resolveResetTurnTimeBase({
            hiddenSeed: 'hidden-seed',
            userId: 'user-7',
            previousTurnTimeBase: first.nextTurnTimeBase,
            tickSeconds: 600,
        });

        expect(second.nextTurnTimeBase).not.toBe(first.nextTurnTimeBase);
        expect(second.nextTurnTimeBase).toBeGreaterThanOrEqual(0);
        expect(second.nextTurnTimeBase).toBeLessThan(600);
    });
});
