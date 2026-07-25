import { describe, expect, it } from 'vitest';

import {
    calculateNationBettingRewards,
    purifyNationBettingSelection,
} from '../src/betting/nationBettingSettlement.js';

describe('nation betting settlement', () => {
    it('sorts selections and rejects duplicates', () => {
        expect(purifyNationBettingSelection([2, 0, 1], 3)).toEqual([0, 1, 2]);
        expect(() => purifyNationBettingSelection([1, 1], 2)).toThrow('중복된 값이 있습니다.');
    });

    it('distributes an exclusive pool proportionally including the system bonus', () => {
        expect(
            calculateNationBettingRewards({
                selectCount: 1,
                isExclusive: null,
                winner: [0],
                stakes: [
                    { generalId: 0, userId: null, selection: [-1], amount: 100 },
                    { generalId: 1, userId: 'one', selection: [0], amount: 100 },
                    { generalId: 2, userId: 'two', selection: [1], amount: 100 },
                ],
            })
        ).toEqual([{ generalId: 1, userId: 'one', amount: 300, matchPoint: 1 }]);
    });

    it('preserves the legacy no-refund bug when an exclusive bet has no winner', () => {
        expect(
            calculateNationBettingRewards({
                selectCount: 1,
                isExclusive: null,
                winner: [0],
                stakes: [{ generalId: 2, userId: 'two', selection: [1], amount: 100 }],
            })
        ).toEqual([]);
    });

    it('rolls empty tiers down and assigns the remainder to the highest winning tier', () => {
        const rewards = calculateNationBettingRewards({
            selectCount: 3,
            isExclusive: false,
            winner: [0, 1, 2],
            stakes: [
                { generalId: 0, userId: null, selection: [-1], amount: 400 },
                { generalId: 1, userId: 'exact', selection: [0, 1, 2], amount: 100 },
                { generalId: 2, userId: 'partial-a', selection: [0, 1, 4], amount: 100 },
                { generalId: 3, userId: 'partial-b', selection: [0, 5, 6], amount: 100 },
            ],
        });
        expect(rewards).toEqual([
            { generalId: 1, userId: 'exact', amount: 437.5, matchPoint: 3 },
            { generalId: 2, userId: 'partial-a', amount: 175, matchPoint: 2 },
            { generalId: 3, userId: 'partial-b', amount: 87.5, matchPoint: 1 },
        ]);
    });
});
