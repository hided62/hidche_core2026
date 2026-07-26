import { describe, expect, it } from 'vitest';

import { getNextTurnAt, type TurnSchedule } from '../src/turn/calendar.js';

describe('turn calendar', () => {
    it('adds the active turn interval without cutting a general timestamp to a global boundary', () => {
        const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
        const current = new Date('2026-07-26T13:38:45.123Z');

        expect(getNextTurnAt(current, schedule).toISOString()).toBe('2026-07-26T13:48:45.123Z');
    });

    it('uses the interval active at the current timestamp when crossing a schedule segment', () => {
        const schedule: TurnSchedule = {
            entries: [
                { startMinute: 0, tickMinutes: 10 },
                { startMinute: 14 * 60, tickMinutes: 5 },
            ],
        };
        const current = new Date('2026-07-26T13:58:45.000Z');

        expect(getNextTurnAt(current, schedule).toISOString()).toBe('2026-07-26T14:08:45.000Z');
    });
});
