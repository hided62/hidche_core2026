import { GameClock } from '@sammo-ts/common';
import { describe, expect, test } from 'vitest';
import { calculateInitialTurnTick } from '../src/scenario/scenarioSeeder.js';

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
});
