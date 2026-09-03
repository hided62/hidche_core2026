import { createHash } from 'node:crypto';

import { GameClock, parseGameClockPhase } from '@sammo-ts/common';
import {
    CLOCK_OPERATION_PERSISTENCE_LOCK,
    GamePrisma,
    acquireGameSchemaAdvisoryXactLock,
    type GamePrismaClient,
} from '@sammo-ts/infra';

interface ClockProjectionRedis {
    get(key: string): Promise<string | null>;
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

interface ClaimedOutboxRow {
    id: bigint;
}

interface DbWallRow {
    wallNow: Date;
}

interface ProjectionPayload {
    version: 1;
    profileName: string;
    suspensionId: string;
    sourceRevision: number;
    targetRevision: number;
    deadlineGeneration: number;
    shiftTicks: number;
    projectionDeltaMilliseconds: number;
    clockBaseTime: string;
    ticksPerSecond: number;
}

interface TournamentProjectionState {
    stage?: number;
    nextAt?: string;
    nextTick?: number;
    bettingCloseAt?: string;
    bettingCloseTick?: number;
    clockRevision?: number;
    deadlineGeneration?: number;
    [key: string]: unknown;
}

const APPLY_CLOCK_PROJECTION_SCRIPT = `
local active = redis.call('GET', KEYS[1])
if active == ARGV[2] then
  if redis.call('GET', KEYS[5]) == ARGV[4] and redis.call('GET', KEYS[2]) == ARGV[3] then
    return 2
  end
  return -3
end
if active and active ~= ARGV[1] then
  return -1
end
if ARGV[5] ~= '__NONE__' and redis.call('GET', KEYS[4]) ~= ARGV[5] then
  return -2
end
redis.call('DEL', KEYS[3])
local count = tonumber(ARGV[7])
local offset = 8
for index = 1, count do
  redis.call('ZADD', KEYS[3], ARGV[offset], ARGV[offset + 1])
  offset = offset + 2
end
if ARGV[5] ~= '__NONE__' then
  redis.call('SET', KEYS[4], ARGV[6])
end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[3])
redis.call('SET', KEYS[5], ARGV[4])
redis.call('SET', KEYS[6], 'RUNNING')
return 1
`;

const safeInteger = (value: unknown, label: string): number => {
    const result = typeof value === 'bigint' ? Number(value) : value;
    if (typeof result !== 'number' || !Number.isSafeInteger(result)) {
        throw new Error(`${label} must be a safe integer.`);
    }
    return result;
};

const canonicalize = (value: unknown): unknown => {
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, canonicalize(item)])
        );
    }
    return value;
};

const stableJson = (value: unknown): string => JSON.stringify(canonicalize(value));

const checksum = (value: unknown): string => createHash('sha256').update(stableJson(value)).digest('hex');

const readDbWall = async (db: GamePrisma.TransactionClient): Promise<Date> => {
    const rows = await db.$queryRaw<DbWallRow[]>(GamePrisma.sql`
        SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamp(3) AS "wallNow"
    `);
    if (!rows[0]?.wallNow) throw new Error('Failed to read PostgreSQL wall time for the projection outbox.');
    return rows[0].wallNow;
};

const parsePayload = (value: GamePrisma.JsonValue): ProjectionPayload => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Clock projection outbox payload must be an object.');
    }
    const payload = value as Record<string, unknown>;
    if (payload.version !== 1 || typeof payload.profileName !== 'string' || typeof payload.suspensionId !== 'string') {
        throw new Error('Clock projection outbox payload identity is invalid.');
    }
    if (typeof payload.clockBaseTime !== 'string') {
        throw new Error('Clock projection outbox is missing its projection base.');
    }
    return {
        version: 1,
        profileName: payload.profileName,
        suspensionId: payload.suspensionId,
        sourceRevision: safeInteger(payload.sourceRevision, 'sourceRevision'),
        targetRevision: safeInteger(payload.targetRevision, 'targetRevision'),
        deadlineGeneration: safeInteger(payload.deadlineGeneration, 'deadlineGeneration'),
        shiftTicks: safeInteger(payload.shiftTicks, 'shiftTicks'),
        projectionDeltaMilliseconds: safeInteger(
            payload.projectionDeltaMilliseconds,
            'projectionDeltaMilliseconds'
        ),
        clockBaseTime: payload.clockBaseTime,
        ticksPerSecond: safeInteger(payload.ticksPerSecond, 'ticksPerSecond'),
    };
};

const claimNext = async (db: GamePrismaClient, workerId: string) =>
    db.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<ClaimedOutboxRow[]>(GamePrisma.sql`
            SELECT id
            FROM clock_projection_outbox
            WHERE available_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
              AND (
                status IN ('PENDING', 'FAILED')
                OR (status = 'APPLYING' AND locked_at < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '30 seconds')
              )
            ORDER BY id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        `);
        const id = rows[0]?.id;
        if (id === undefined) return null;
        const lockedAt = await readDbWall(transaction);
        return transaction.clockProjectionOutbox.update({
            where: { id },
            data: {
                status: 'APPLYING',
                attempts: { increment: 1 },
                lockedAt,
                lockedBy: workerId,
                lastError: null,
            },
        });
    });

const projectTournamentState = (
    raw: string | null,
    payload: ProjectionPayload,
    clock: GameClock
): { expected: string; next: string } | null => {
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TournamentProjectionState;
    const active = typeof parsed.stage === 'number' && parsed.stage > 0;
    if (active && parsed.nextAt && !Number.isSafeInteger(parsed.nextTick)) {
        throw new Error('Active tournament nextAt lacks the authoritative nextTick dual-write.');
    }
    if (active && parsed.bettingCloseAt && !Number.isSafeInteger(parsed.bettingCloseTick)) {
        throw new Error('Active tournament bettingCloseAt lacks the authoritative bettingCloseTick dual-write.');
    }
    const next: TournamentProjectionState = {
        ...parsed,
        clockRevision: payload.targetRevision,
        deadlineGeneration: payload.deadlineGeneration,
    };
    if (Number.isSafeInteger(parsed.nextTick)) {
        next.nextTick = parsed.nextTick! + payload.shiftTicks;
        next.nextAt = clock.tickToDate(next.nextTick).toISOString();
    }
    if (Number.isSafeInteger(parsed.bettingCloseTick)) {
        next.bettingCloseTick = parsed.bettingCloseTick! + payload.shiftTicks;
        next.bettingCloseAt = clock.tickToDate(next.bettingCloseTick).toISOString();
    }
    return { expected: raw, next: JSON.stringify(next) };
};

const recordFailure = async (db: GamePrismaClient, outboxId: bigint, error: unknown): Promise<void> => {
    const message = error instanceof Error ? error.message : String(error);
    await db.$executeRaw(GamePrisma.sql`
        UPDATE clock_projection_outbox
        SET status = 'FAILED',
            locked_at = NULL,
            locked_by = NULL,
            last_error = ${message.slice(0, 4_000)},
            available_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '1 second'
        WHERE id = ${outboxId} AND status = 'APPLYING'
    `);
};

export const applyNextClockProjection = async (options: {
    db: GamePrismaClient;
    redis: ClockProjectionRedis;
    workerId: string;
}): Promise<'IDLE' | 'APPLIED' | 'RECOVERED'> => {
    if (!options.workerId.trim()) throw new Error('Clock projection worker ID is required.');
    const outbox = await claimNext(options.db, options.workerId);
    if (!outbox) return 'IDLE';
    try {
        const payload = parsePayload(outbox.payload);
        if (checksum(outbox.payload) !== outbox.checksum) {
            throw new Error('Clock projection outbox checksum verification failed.');
        }
        if (outbox.targetRevision !== BigInt(payload.targetRevision)) {
            throw new Error('Clock projection payload revision differs from its outbox row.');
        }
        const world = await options.db.worldState.findUniqueOrThrow({ where: { id: outbox.worldStateId } });
        if (
            parseGameClockPhase(world.clockPhase) !== 'RECONCILING' ||
            world.clockRevision !== outbox.targetRevision ||
            world.deadlineGeneration !== BigInt(payload.deadlineGeneration) ||
            !world.clockBaseTime
        ) {
            throw new Error('Clock projection DB phase/revision/generation fence failed.');
        }
        const clock = new GameClock({
            baseTime: new Date(payload.clockBaseTime),
            tick: safeInteger(world.clockTick, 'world clock tick'),
            mode: world.clockMode === 'manual' ? 'manual' : 'realtime',
            wallAnchor: world.clockWallAnchor ?? new Date(),
            turnSeconds: world.tickSeconds,
            phase: 'RECONCILING',
            revision: payload.targetRevision,
        });
        if (clock.ticksPerSecond !== payload.ticksPerSecond) {
            throw new Error('Clock projection rate differs from the durable outbox payload.');
        }
        const auctions = await options.db.auction.findMany({
            where: { status: { in: ['OPEN', 'FINALIZING'] } },
            orderBy: { id: 'asc' },
            select: { id: true, closeTick: true },
        });
        const timers = auctions.map((auction) => {
            if (auction.closeTick === null) {
                throw new Error(`Active auction ${auction.id} lacks closeTick during projection rebuild.`);
            }
            return { score: safeInteger(auction.closeTick, `auction ${auction.id} closeTick`), id: String(auction.id) };
        });
        const prefix = `sammo:${payload.profileName}`;
        const tournamentKey = `${prefix}:tournament:state`;
        const tournament = projectTournamentState(await options.redis.get(tournamentKey), payload, clock);
        const result = await options.redis.eval(APPLY_CLOCK_PROJECTION_SCRIPT, {
            keys: [
                `${prefix}:clock:active-revision`,
                `${prefix}:clock:deadline-generation`,
                `${prefix}:auction:timer`,
                tournamentKey,
                `${prefix}:clock:projection-checksum`,
                `${prefix}:clock:phase`,
            ],
            arguments: [
                String(payload.sourceRevision),
                String(payload.targetRevision),
                String(payload.deadlineGeneration),
                outbox.checksum,
                tournament?.expected ?? '__NONE__',
                tournament?.next ?? '__NONE__',
                String(timers.length),
                ...timers.flatMap(({ score, id }) => [String(score), id]),
            ],
        });
        const applied = Number(result);
        if (applied === -1) throw new Error('Redis active clock revision does not match the outbox source revision.');
        if (applied === -2) throw new Error('Redis tournament state changed while rebuilding its projection.');
        if (applied === -3) throw new Error('Redis target revision exists without the expected projection checksum.');
        if (applied !== 1 && applied !== 2) throw new Error(`Unexpected Redis clock projection result: ${String(result)}`);

        await options.db.$transaction(async (transaction) => {
            await acquireGameSchemaAdvisoryXactLock(transaction, CLOCK_OPERATION_PERSISTENCE_LOCK);
            await transaction.$queryRaw<ClaimedOutboxRow[]>(GamePrisma.sql`
                SELECT id FROM world_state WHERE id = ${outbox.worldStateId} FOR UPDATE
            `);
            const finalized = await transaction.worldState.updateMany({
                where: {
                    id: outbox.worldStateId,
                    clockPhase: 'RECONCILING',
                    clockRevision: outbox.targetRevision,
                    deadlineGeneration: BigInt(payload.deadlineGeneration),
                },
                data: { clockPhase: 'RUNNING' },
            });
            if (finalized.count !== 1) {
                throw new Error('Clock projection final RUNNING transition fence failed.');
            }
            const appliedAt = await readDbWall(transaction);
            await transaction.clockProjectionOutbox.update({
                where: { id: outbox.id },
                data: { status: 'APPLIED', appliedAt, lockedAt: null, lockedBy: null, lastError: null },
            });
            if (outbox.suspensionId) {
                await transaction.clockSuspension.update({
                    where: { id: outbox.suspensionId },
                    data: { status: 'APPLIED' },
                });
            }
        });
        return applied === 2 ? 'RECOVERED' : 'APPLIED';
    } catch (error) {
        await recordFailure(options.db, outbox.id, error);
        throw error;
    }
};

export const loadClockReconciliationReadiness = async (db: GamePrismaClient) => {
    const world = await db.worldState.findFirst({
        orderBy: { id: 'asc' },
        select: { clockPhase: true, clockRevision: true, deadlineGeneration: true },
    });
    const incompleteOutboxCount = await db.clockProjectionOutbox.count({ where: { status: { not: 'APPLIED' } } });
    if (!world) {
        return { ready: false, phase: null, revision: null, deadlineGeneration: null, incompleteOutboxCount };
    }
    const phase = parseGameClockPhase(world.clockPhase);
    return {
        ready: phase !== 'RECONCILING' && incompleteOutboxCount === 0,
        gameplayEnabled: phase === 'RUNNING' || phase === 'MANUAL',
        phase,
        revision: safeInteger(world.clockRevision, 'clock revision'),
        deadlineGeneration: safeInteger(world.deadlineGeneration, 'deadline generation'),
        incompleteOutboxCount,
    };
};
