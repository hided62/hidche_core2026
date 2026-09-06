import { GameClock, readTurnRecovery, inferClockPhase, parseGameClockPhase } from '@sammo-ts/common';

import { GamePrisma, type GamePrismaClient } from './gamePrisma.js';
import { acquireGameSchemaAdvisoryXactLock, CLOCK_OPERATION_PERSISTENCE_LOCK } from './gameSchemaAdvisoryLock.js';

type ClockAcceptanceDatabase = Pick<GamePrismaClient, '$executeRaw' | '$queryRaw' | 'worldState'>;

interface DbWallRow {
    wallNow: Date;
}

/** 새 daemon의 시계 복구가 끝나기 전에는 독립 worker가 시간을 진행하지 않는다. */
export const readTurnRuntimeReady = async (
    db: Pick<GamePrismaClient, '$queryRaw'>,
    revision: bigint
): Promise<boolean> => {
    const [row] = await db.$queryRaw<Array<{ ready: boolean }>>(GamePrisma.sql`
        SELECT EXISTS (
            SELECT 1 FROM turn_daemon_lease, world_state
            WHERE clock_ready = TRUE AND lease_until > timezone('UTC', clock_timestamp())
              AND clock_revision = ${revision}
        ) AS ready
    `);
    return row?.ready === true;
};

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
            clockRecoveryStartTick: true,
            clockRecoveryEndTick: true,
            clockRecoveryStartWallAt: true,
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
        recovery: readTurnRecovery(world),
        turnSeconds: world.tickSeconds,
        phase,
        revision,
    });
    const ready =
        phase !== 'RUNNING' ||
        mode !== 'realtime' ||
        world.clockRecoveryStartTick === undefined ||
        (await readTurnRuntimeReady(db, world.clockRevision));
    const observedTick = ready ? clock.nowTick(wall.wallNow) : clock.tick;
    return {
        wallAt: wall.wallNow,
        gameAt: clock.tickToDate(observedTick),
        gameTick: BigInt(observedTick),
        clockRevision: BigInt(revision),
        deadlineGeneration: BigInt(generation),
        phase,
    };
};
