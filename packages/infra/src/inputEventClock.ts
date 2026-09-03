import { GameClock, inferClockPhase, parseGameClockPhase } from '@sammo-ts/common';

import { GamePrisma, type GamePrismaClient } from './gamePrisma.js';
import { acquireGameSchemaAdvisoryXactLock, CLOCK_OPERATION_PERSISTENCE_LOCK } from './gameSchemaAdvisoryLock.js';

type ClockAcceptanceDatabase = Pick<GamePrismaClient, '$executeRaw' | '$queryRaw' | 'worldState'>;

interface DbWallRow {
    wallNow: Date;
}

export interface InputEventClockCoordinate {
    wallAt: Date;
    gameAt: Date;
    gameTick: bigint;
    clockRevision: bigint;
    deadlineGeneration: bigint;
    phase: string;
}

/**
 * Reads one input-event acceptance coordinate while holding the same schema
 * clock-operation fence used by reconciliation. The caller must create the
 * input_event in this transaction before releasing the lock.
 */
export const readInputEventClockCoordinate = async (
    db: ClockAcceptanceDatabase
): Promise<InputEventClockCoordinate> => {
    await acquireGameSchemaAdvisoryXactLock(db, CLOCK_OPERATION_PERSISTENCE_LOCK);
    const [wall] = await db.$queryRaw<DbWallRow[]>(GamePrisma.sql`
        SELECT timezone('UTC', clock_timestamp()) AS "wallNow"
    `);
    if (!wall) throw new Error('PostgreSQL did not return its authoritative wall clock.');
    const world = await db.worldState.findFirst({
        orderBy: { id: 'asc' },
        select: {
            clockBaseTime: true,
            clockTick: true,
            clockMode: true,
            clockWallAnchor: true,
            tickSeconds: true,
            clockPhase: true,
            clockRevision: true,
            deadlineGeneration: true,
        },
    });
    if (!world?.clockBaseTime || world.clockTick === null || !world.clockWallAnchor) {
        throw new Error('The authoritative game clock is not initialized.');
    }
    const tick = Number(world.clockTick);
    const revision = Number(world.clockRevision);
    const generation = Number(world.deadlineGeneration);
    if (!Number.isSafeInteger(tick) || !Number.isSafeInteger(revision) || !Number.isSafeInteger(generation)) {
        throw new Error('The authoritative game clock coordinate is outside the safe integer range.');
    }
    const mode = world.clockMode === 'manual' ? 'manual' : 'realtime';
    const phase = world.clockPhase ? parseGameClockPhase(world.clockPhase) : inferClockPhase(mode);
    const clock = new GameClock({
        baseTime: world.clockBaseTime,
        tick,
        mode,
        wallAnchor: world.clockWallAnchor,
        turnSeconds: world.tickSeconds,
        phase,
        revision,
    });
    const observedTick = clock.nowTick(wall.wallNow);
    return {
        wallAt: wall.wallNow,
        gameAt: clock.tickToDate(observedTick),
        gameTick: BigInt(observedTick),
        clockRevision: BigInt(revision),
        deadlineGeneration: BigInt(generation),
        phase,
    };
};
