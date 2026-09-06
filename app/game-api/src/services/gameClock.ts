import {
    GameClock,
    readTurnRecovery,
    inferClockPhase,
    parseGameClockPhase,
    type GameClockMode,
    type GameClockPhase,
} from '@sammo-ts/common';

import type { DatabaseClient } from '../context.js';
import { readTurnRuntimeReady } from '@sammo-ts/infra';

export interface CurrentGameTime {
    now: Date;
    wallNow: Date;
    tick: number | null;
    mode: GameClockMode | null;
    phase?: GameClockPhase | null;
    revision?: number | null;
    deadlineGeneration?: number | null;
    running: boolean;
    runtimeReady?: boolean;
    recovery?: { startsAt: string; endsAt: string } | null;
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
            phase: null,
            revision: null,
            deadlineGeneration: null,
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
            clockRecoveryStartTick: true,
            clockRecoveryEndTick: true,
            clockRecoveryStartWallAt: true,
            tickSeconds: true,
            clockPhase: true,
            clockRevision: true,
            deadlineGeneration: true,
        },
    });
    if (!state?.clockBaseTime || state.clockTick === null || !state.clockWallAnchor) {
        return {
            now: wallNow,
            wallNow,
            tick: null,
            mode: null,
            phase: null,
            revision: null,
            deadlineGeneration: null,
            running: true,
            startsAt: null,
            dateToTick: () => null,
        };
    }
    const mode: GameClockMode = state.clockMode === 'manual' ? 'manual' : 'realtime';
    // During the dual-read migration an older profile (or a rolling-deploy
    // fixture) can lack clock_phase. Preserve the existing future-anchor
    // PREOPEN contract until every profile has the authoritative column.
    const phase = state.clockPhase
        ? parseGameClockPhase(state.clockPhase)
        : mode === 'realtime' && wallNow.getTime() < state.clockWallAnchor.getTime()
          ? 'PREOPEN'
          : inferClockPhase(mode);
    const storedTick = Number(state.clockTick);
    if (!Number.isSafeInteger(storedTick)) {
        throw new Error(`world_state.clock_tick is outside the JavaScript safe integer range: ${state.clockTick}`);
    }
    const revision = Number(state.clockRevision ?? 1n);
    const deadlineGeneration = Number(state.deadlineGeneration ?? 1n);
    if (!Number.isSafeInteger(revision) || !Number.isSafeInteger(deadlineGeneration)) {
        throw new Error('world_state clock revision or deadline generation is outside the safe integer range.');
    }
    const clock = new GameClock({
        baseTime: state.clockBaseTime,
        tick: storedTick,
        mode,
        wallAnchor: state.clockWallAnchor,
        recovery: readTurnRecovery(state),
        turnSeconds: state.tickSeconds,
        phase,
        revision,
    });
    const runtimeReady =
        phase !== 'RUNNING' ||
        mode !== 'realtime' ||
        state.clockRecoveryStartTick === undefined ||
        (await readTurnRuntimeReady(db, state.clockRevision));
    const tick = runtimeReady ? clock.nowTick(wallNow) : clock.tick;
    const running = runtimeReady && phase === 'RUNNING' && mode === 'realtime' && wallNow >= clock.wallAnchor;
    return {
        now: clock.tickToDate(tick),
        wallNow,
        tick,
        mode,
        phase,
        revision,
        deadlineGeneration,
        running,
        runtimeReady,
        recovery:
            clock.recovery && clock.tickToWallDate(clock.recovery.endTick) > wallNow
                ? {
                      startsAt: clock.recovery.startWallAt.toISOString(),
                      endsAt: clock.tickToWallDate(clock.recovery.endTick).toISOString(),
                  }
                : null,
        startsAt:
            phase === 'PREOPEN' || (phase === 'RUNNING' && wallNow < clock.wallAnchor) ? state.clockWallAnchor : null,
        dateToTick: (date) => clock.dateToTick(date),
    };
};
