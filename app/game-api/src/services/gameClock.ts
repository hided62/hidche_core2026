import { GameClock, type GameClockMode } from '@sammo-ts/common';

import type { DatabaseClient } from '../context.js';

export interface CurrentGameTime {
    now: Date;
    wallNow: Date;
    tick: number | null;
    mode: GameClockMode | null;
    running: boolean;
    startsAt: Date | null;
    dateToTick(date: Date): number | null;
}

export const loadCurrentGameTime = async (db: DatabaseClient, wallNow = new Date()): Promise<CurrentGameTime> => {
    if (!db.worldState) {
        return {
            now: wallNow,
            wallNow,
            tick: null,
            mode: null,
            running: true,
            startsAt: null,
            dateToTick: () => null,
        };
    }
    const state = await db.worldState.findFirst({
        orderBy: { id: 'asc' },
        select: {
            clockBaseTime: true,
            clockTick: true,
            clockMode: true,
            clockWallAnchor: true,
            tickSeconds: true,
        },
    });
    if (!state?.clockBaseTime || state.clockTick === null || !state.clockWallAnchor) {
        return {
            now: wallNow,
            wallNow,
            tick: null,
            mode: null,
            running: true,
            startsAt: null,
            dateToTick: () => null,
        };
    }
    const mode: GameClockMode = state.clockMode === 'manual' ? 'manual' : 'realtime';
    const storedTick = Number(state.clockTick);
    if (!Number.isSafeInteger(storedTick)) {
        throw new Error(`world_state.clock_tick is outside the JavaScript safe integer range: ${state.clockTick}`);
    }
    const clock = new GameClock({
        baseTime: state.clockBaseTime,
        tick: storedTick,
        mode,
        wallAnchor: state.clockWallAnchor,
        turnSeconds: state.tickSeconds,
    });
    const tick = clock.nowTick(wallNow);
    const running = mode === 'realtime' && wallNow.getTime() >= state.clockWallAnchor.getTime();
    return {
        now: clock.tickToDate(tick),
        wallNow,
        tick,
        mode,
        running,
        startsAt: mode === 'realtime' && !running ? state.clockWallAnchor : null,
        dateToTick: (date) => clock.dateToTick(date),
    };
};
