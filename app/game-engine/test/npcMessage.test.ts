import { describe, expect, it, vi } from 'vitest';

import { selectNpcMessageForTurn } from '../src/turn/ai/generalAi/core.js';

describe('legacy NPC public chatter', () => {
    it('uses the per-turn legacy probability and returns the scenario text', () => {
        const nextBool = vi.fn(() => true);

        expect(selectNpcMessageForTurn('기부는 저처럼 돈 많은 사람들이 많이 하면 됩니다', { nextBool }, 2, 10)).toBe(
            '기부는 저처럼 돈 많은 사람들이 많이 하면 됩니다'
        );
        expect(nextBool).toHaveBeenCalledWith(2 / 144);
    });

    it('does not consume RNG when a scenario NPC has no message', () => {
        const nextBool = vi.fn(() => true);
        expect(selectNpcMessageForTurn(null, { nextBool }, 2, 10)).toBeNull();
        expect(nextBool).not.toHaveBeenCalled();
    });
});
