import { describe, expect, it } from 'vitest';

import {
    GAME_TICKS_PER_TURN,
    GameClock,
    MAX_SAFE_GAME_TICK,
    asGameTick,
    asObservedGameInstant,
    buildClockAlignmentPlan,
    buildExactClockAlignmentPlan,
    createDeadline,
    scheduleNotBefore,
} from '../src/time/GameClock.js';

describe('GameClock', () => {
    it.each(['SUSPENDED', 'RECONCILING'] as const)(
        'keeps the authoritative tick frozen across 24 wall hours while %s',
        (phase) => {
            const clock = new GameClock({
                baseTime: new Date('0200-01-01T00:00:00.000Z'),
                tick: 12_345,
                mode: 'realtime',
                wallAnchor: new Date('2026-09-03T15:00:00.000Z'),
                turnSeconds: 600,
                phase,
                revision: 7,
            });

            expect(clock.nowTick(new Date('2026-09-04T15:00:00.000Z'))).toBe(12_345);
            expect(clock.now(new Date('2026-09-04T15:00:00.000Z'))).toEqual(clock.tickToDate(12_345));
        }
    );

    const baseTime = new Date('2042-01-01T00:00:00.000Z');

    it('projects the fixed Ref turn tick and ignores wall time in manual mode', () => {
        const clock = new GameClock({
            baseTime,
            tick: GAME_TICKS_PER_TURN,
            mode: 'manual',
            wallAnchor: new Date('2026-01-01T00:00:00.000Z'),
            turnSeconds: 3_600,
        });

        expect(clock.ticksPerSecond).toBe(10_000);
        expect(clock.nowTick(new Date('2126-01-01T00:00:00.000Z'))).toBe(GAME_TICKS_PER_TURN);
        expect(clock.now(new Date('2126-01-01T00:00:00.000Z')).toISOString()).toBe('2042-01-01T01:00:00.000Z');
    });

    it('accepts a large forward wall jump without losing tick precision', () => {
        const wallAnchor = new Date('2026-01-01T00:00:00.000Z');
        const clock = new GameClock({
            baseTime,
            tick: 0,
            mode: 'realtime',
            wallAnchor,
            turnSeconds: 7_200,
        });
        const jumped = new Date('2126-01-01T00:00:00.000Z');
        const tick = clock.nowTick(jumped);

        expect(Number.isSafeInteger(tick)).toBe(true);
        expect(clock.tickToDate(tick).getTime() - baseTime.getTime()).toBe(jumped.getTime() - wallAnchor.getTime());
    });

    it('projects a negative tick before a future realtime anchor', () => {
        const clock = new GameClock({
            baseTime,
            tick: 0,
            mode: 'realtime',
            wallAnchor: new Date('2026-01-01T01:00:00.000Z'),
            turnSeconds: 3_600,
            phase: 'PREOPEN',
        });

        expect(clock.nowTick(new Date('2026-01-01T00:30:00.000Z'))).toBe(-GAME_TICKS_PER_TURN / 2);
        expect(clock.nowTick(new Date('2026-01-01T01:00:00.000Z'))).toBe(0);
    });

    it('does not rewind a RUNNING realtime tick when wall time moves backward', () => {
        const clock = new GameClock({
            baseTime,
            tick: GAME_TICKS_PER_TURN,
            mode: 'realtime',
            wallAnchor: new Date('2026-01-01T01:00:00.000Z'),
            turnSeconds: 3_600,
            phase: 'RUNNING',
            revision: 7,
        });

        expect(clock.nowTick(new Date('2026-01-01T00:59:55.000Z'))).toBe(GAME_TICKS_PER_TURN);
        expect(clock.revision).toBe(7);
    });

    it('floors PREOPEN executable schedules at opening tick zero', () => {
        const observed = asObservedGameInstant(-GAME_TICKS_PER_TURN / 2);

        expect(scheduleNotBefore(observed, 'PREOPEN')).toBe(0);
        expect(createDeadline(observed, asGameTick(GAME_TICKS_PER_TURN / 4), 'PREOPEN')).toBe(0);
        expect(scheduleNotBefore(observed, 'RUNNING')).toBe(observed);
    });

    it('preserves a 65 minute 17.250 second sub-turn suspension remainder exactly', () => {
        const plan = buildExactClockAlignmentPlan({
            sourceRevision: 11,
            cutTick: 123_456,
            cutWall: new Date('2026-01-01T00:00:00.000Z'),
            resumeWall: new Date('2026-01-01T01:05:17.250Z'),
            ticksPerSecond: 10_000,
        });

        expect(plan).toMatchObject({
            sourceRevision: 11,
            targetRevision: 12,
            gapTicks: 39_172_500,
            shiftTicks: 39_172_500,
            alignedTick: 39_295_956,
        });
        expect(plan.shiftTicks % GAME_TICKS_PER_TURN).toBe(3_172_500);
    });

    it('aligns a 24 hour exact maintenance without catch-up', () => {
        const plan = buildExactClockAlignmentPlan({
            sourceRevision: 1,
            cutTick: 2 * GAME_TICKS_PER_TURN,
            cutWall: new Date('2026-01-01T00:00:00.000Z'),
            resumeWall: new Date('2026-01-02T00:00:00.000Z'),
            ticksPerSecond: 10_000,
        });

        expect(plan.gapTicks).toBe(24 * GAME_TICKS_PER_TURN);
        expect(plan.alignedTick).toBe(26 * GAME_TICKS_PER_TURN);
    });

    it('keeps legacy complete-turn rebasing separate from bounded catch-up', () => {
        const common = {
            sourceRevision: 4,
            cutTick: 100,
            cutWall: new Date('2026-01-01T00:00:00.000Z'),
            resumeWall: new Date('2026-01-01T01:05:17.250Z'),
            ticksPerSecond: 10_000,
        };
        const legacy = buildClockAlignmentPlan({ ...common, policy: 'LEGACY_COMPLETE_TURNS' });
        const catchUp = buildClockAlignmentPlan({ ...common, policy: 'CATCH_UP', catchUpTicks: 1_000_000 });

        expect(legacy).toMatchObject({
            policy: 'LEGACY_COMPLETE_TURNS',
            gapTicks: 39_172_500,
            shiftTicks: GAME_TICKS_PER_TURN,
            catchUpTicks: 3_172_500,
        });
        expect(catchUp).toMatchObject({
            policy: 'CATCH_UP',
            gapTicks: 39_172_500,
            shiftTicks: 38_172_500,
            catchUpTicks: 1_000_000,
        });
        expect(() => buildClockAlignmentPlan({ ...common, policy: 'EXACT', catchUpTicks: 1 })).toThrow(
            'EXACT alignment does not allow catch-up ticks'
        );
    });

    it('preserves schedule ordering, remaining distance, and occurrence ticks across generated exact gaps', () => {
        let seed = 0x5eed1234;
        const next = (): number => {
            seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
            return seed;
        };
        for (let iteration = 0; iteration < 500; iteration += 1) {
            const cutTick = next() % 1_000_000_000;
            const gapMilliseconds = next() % (7 * 24 * 60 * 60 * 1_000);
            const ticksPerSecond = [5_000, 10_000, 60_000][next() % 3]!;
            const offsets = Array.from({ length: 8 }, () => next() % (3 * GAME_TICKS_PER_TURN)).sort(
                (left, right) => left - right
            );
            const occurrenceTicks = Array.from({ length: 4 }, () => cutTick - (next() % GAME_TICKS_PER_TURN));
            const plan = buildClockAlignmentPlan({
                policy: 'EXACT',
                sourceRevision: 1 + (next() % 10_000),
                cutTick,
                cutWall: new Date(0),
                resumeWall: new Date(gapMilliseconds),
                ticksPerSecond,
            });
            const shifted = offsets.map((offset) => cutTick + offset + plan.shiftTicks);

            expect(shifted.map((deadline) => deadline - plan.alignedTick)).toEqual(offsets);
            expect([...shifted].sort((left, right) => left - right)).toEqual(shifted);
            expect(occurrenceTicks).toEqual([...occurrenceTicks]);
        }
    });

    it('projects near the safe tick boundary without unsafe intermediate multiplication', () => {
        const clock = new GameClock({
            baseTime: new Date(0),
            tick: 0,
            mode: 'manual',
            wallAnchor: new Date(0),
            turnSeconds: 7_200,
        });
        const tick = MAX_SAFE_GAME_TICK - (MAX_SAFE_GAME_TICK % clock.ticksPerSecond);
        const projected = clock.tickToDate(tick);

        expect(Number.isNaN(projected.getTime())).toBe(false);
        expect(clock.dateToTick(projected)).toBe(tick);
    });

    it('truncates sub-millisecond projections like Ref GameClock', () => {
        const clock = new GameClock({
            baseTime,
            tick: 0,
            mode: 'manual',
            wallAnchor: baseTime,
            turnSeconds: 600,
        });

        expect(clock.tickToDate(14_115_919).toISOString()).toBe('2042-01-01T00:03:55.265Z');
        expect(clock.tickToDate(-1).toISOString()).toBe('2041-12-31T23:59:59.999Z');
    });
});
