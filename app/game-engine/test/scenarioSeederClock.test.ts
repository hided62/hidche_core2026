import { GameClock } from '@sammo-ts/common';
import { describe, expect, test } from 'vitest';
import { calculateInitialTurnTick, resolveInitialClockPhase } from '../src/scenario/scenarioSeeder.js';

describe('scenario seeder general turn tick', () => {
    test('preserves Ref-compatible sub-millisecond RNG precision', () => {
        const now = new Date('2026-08-02T00:03:44.000Z');
        const clock = new GameClock({
            baseTime: new Date('2026-08-02T01:00:00.000Z'),
            tick: 0,
            mode: 'manual',
            wallAnchor: now,
            turnSeconds: 600,
        });
        const baseTick = clock.dateToTick(now);

        expect(calculateInitialTurnTick(clock, baseTick, 235_265_319)).toBe(baseTick + 14_115_919);
        expect(clock.dateToTick(new Date(now.getTime() + 235_265))).toBe(baseTick + 14_115_900);
    });

    test('keeps formal opening at tick zero while PREOPEN projects signed ticks', () => {
        const seededAt = new Date('2030-01-01T01:00:00.000Z');
        const openAt = new Date('2030-01-01T02:00:00.000Z');
        const phase = resolveInitialClockPhase('realtime', seededAt, openAt);
        const clock = new GameClock({
            baseTime: new Date('0190-01-01T00:00:00.000Z'),
            tick: 0,
            mode: 'realtime',
            wallAnchor: openAt,
            turnSeconds: 600,
            phase,
        });

        expect(phase).toBe('PREOPEN');
        expect(clock.nowTick(seededAt)).toBe(-6 * 36_000_000);
        expect(clock.nowTick(openAt)).toBe(0);
        expect(calculateInitialTurnTick(clock, 0, 0)).toBe(0);
        expect(calculateInitialTurnTick(clock, 0, 235_265_319)).toBeGreaterThanOrEqual(0);
    });

    test('uses explicit MANUAL and immediate RUNNING phases', () => {
        const now = new Date('2030-01-01T01:00:00.000Z');

        expect(resolveInitialClockPhase('manual', now, new Date('2030-01-02T01:00:00.000Z'))).toBe('MANUAL');
        expect(resolveInitialClockPhase('realtime', now, now)).toBe('RUNNING');
    });
});
