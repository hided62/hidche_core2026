import { describe, expect, it } from 'vitest';

import {
    resolveGeneralTypeCall,
    resolveLeadershipBonus,
    resolveNextTurnMonthOffset,
    resolveRefreshScoreText,
    resolveRemainingMinutes,
} from '../src/services/generalBasicCardProjection.js';

describe('general basic card Ref projection', () => {
    it.each([
        [{ leadership: 20, strength: 9, intelligence: 10 }, '아둔'],
        [{ leadership: 20, strength: 20, intelligence: 70 }, '학자'],
        [{ leadership: 20, strength: 70, intelligence: 20 }, '장사'],
        [{ leadership: 20, strength: 35, intelligence: 35 }, '명사'],
        [{ leadership: 80, strength: 75, intelligence: 75 }, '만능'],
        [{ leadership: 60, strength: 70, intelligence: 40 }, '용장'],
        [{ leadership: 60, strength: 40, intelligence: 70 }, '명장'],
        [{ leadership: 70, strength: 30, intelligence: 30 }, '차장'],
        [{ leadership: 60, strength: 60, intelligence: 60 }, '평범'],
    ] as const)('matches the Ref general type rules for %o', (stats, expected) => {
        expect(resolveGeneralTypeCall(stats, 70, 5)).toBe(expected);
    });

    it('matches the Ref officer leadership bonus', () => {
        expect(resolveLeadershipBonus(12, 7)).toBe(14);
        expect(resolveLeadershipBonus(5, 7)).toBe(7);
        expect(resolveLeadershipBonus(4, 7)).toBe(0);
    });

    it('uses the Ref refresh score thresholds', () => {
        expect(resolveRefreshScoreText(99)).toBe('무관심');
        expect(resolveRefreshScoreText(100)).toBe('보통');
        expect(resolveRefreshScoreText(200)).toBe('가끔');
        expect(resolveRefreshScoreText(12_800)).toBe('헐...');
    });

    it('matches the Ref remaining-minute calculation and one-turn rollover', () => {
        const lastExecuted = new Date('2026-08-13T00:00:00.000Z');
        expect(resolveRemainingMinutes(new Date('2026-08-13T00:07:06.000Z'), lastExecuted, 3_600)).toBe(7);
        expect(resolveRemainingMinutes(new Date('2026-08-12T23:59:00.000Z'), lastExecuted, 3_600)).toBe(59);
        expect(resolveRemainingMinutes(new Date('2026-08-13T00:07:06.000Z'), null, 3_600)).toBeNull();
    });

    it('moves the first reserved month only after the general turn bucket has passed', () => {
        const lastExecuted = new Date('2026-08-13T00:00:00.000Z');
        const lastTurnTick = 36_000_000n * 11n;

        expect(
            resolveNextTurnMonthOffset({
                turnTime: new Date('2026-08-13T00:07:00.000Z'),
                turnTick: lastTurnTick + 12_000_000n,
                lastExecuted,
                lastTurnTick,
                turnSeconds: 600,
            })
        ).toBe(0);
        expect(
            resolveNextTurnMonthOffset({
                turnTime: new Date('2026-08-13T00:17:00.000Z'),
                turnTick: lastTurnTick + 48_000_000n,
                lastExecuted,
                lastTurnTick,
                turnSeconds: 600,
            })
        ).toBe(1);
        expect(
            resolveNextTurnMonthOffset({
                turnTime: new Date('2026-08-13T00:10:00.000Z'),
                turnTick: 1n,
                lastExecuted,
                lastTurnTick: -1n,
                turnSeconds: 600,
            })
        ).toBe(1);
    });

    it('keeps the same boundary for legacy Date-only schedules', () => {
        const lastExecuted = new Date('2026-08-13T00:00:00.000Z');
        expect(
            resolveNextTurnMonthOffset({
                turnTime: new Date('2026-08-13T00:07:00.000Z'),
                lastExecuted,
                turnSeconds: 600,
            })
        ).toBe(0);
        expect(
            resolveNextTurnMonthOffset({
                turnTime: new Date('2026-08-13T00:10:00.000Z'),
                lastExecuted,
                turnSeconds: 600,
            })
        ).toBe(1);
    });
});
