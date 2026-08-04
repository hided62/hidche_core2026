import { describe, expect, it } from 'vitest';

import { GAME_TICKS_PER_TURN, GameClock, MAX_SAFE_GAME_TICK } from '../src/time/GameClock.js';

describe('GameClock', () => {
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

    it('does not rewind game time after a backward wall-clock correction', () => {
        const clock = new GameClock({
            baseTime,
            tick: GAME_TICKS_PER_TURN * 10,
            mode: 'realtime',
            wallAnchor: new Date('2026-01-02T00:00:00.000Z'),
            turnSeconds: 3_600,
        });

        expect(clock.nowTick(new Date('2025-01-01T00:00:00.000Z'))).toBe(GAME_TICKS_PER_TURN * 10);
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
});
