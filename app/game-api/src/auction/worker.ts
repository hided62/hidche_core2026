import {
    CLOCK_OPERATION_PERSISTENCE_LOCK,
    GamePrisma,
    acquireGameSchemaAdvisoryXactLock,
    createGamePostgresConnector,
    createRedisConnector,
    type GamePrismaClient,
    resolvePostgresConfigFromEnv,
    resolveRedisConfigFromEnv,
} from '@sammo-ts/infra';

import { resolveGameApiConfigFromEnv } from '../config.js';
import { createBestEffortResourceCloser } from '../services/bestEffortResourceCloser.js';
import { loadCurrentGameTime, type CurrentGameTime } from '../services/gameClock.js';
import { createPollingWorkerControl, waitForWorkerPoll } from '../services/pollingWorkerLifecycle.js';
import { ensureActiveRedisClockFence } from '../services/redisClockFence.js';
import { buildAuctionTimerKeys } from './keys.js';
import { resolveAuctionTimerScore, seedAuctionTimers } from './scheduler.js';

interface RedisTimerClient {
    zRangeByScore(
        key: string,
        min: number,
        max: number,
        options?: { LIMIT?: { offset: number; count: number } }
    ): Promise<string[]>;
    zRangeWithScores(key: string, start: number, stop: number): Promise<Array<{ value: string; score: number }>>;
    zAdd(key: string, values: Array<{ score: number; value: string }>): Promise<number>;
    zRem(key: string, values: string | string[]): Promise<number>;
    zRemRangeByScore(key: string, min: number, max: number): Promise<number>;
    eval?(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

const POP_DUE_AUCTIONS_SCRIPT = `
if redis.call('GET', KEYS[2]) ~= ARGV[1]
   or redis.call('GET', KEYS[3]) ~= ARGV[2]
   or redis.call('GET', KEYS[4]) ~= 'RUNNING' then
  return { '__CLOCK_FENCE__' }
end
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[3], 'LIMIT', 0, ARGV[4])
if #ids > 0 then
  redis.call('ZREM', KEYS[1], unpack(ids))
end
return ids
`;

const AUCTION_FINALIZE_RECOVERY_LIMIT = 1;

interface AuctionFinalizeDeadline {
    closeAt: Date;
    closeTick: bigint | null;
}

interface AuctionFinalizeCommand {
    type: 'auctionFinalize';
    requestId: string;
    auctionId: number;
    expectedCloseAt: string;
    expectedCloseTick?: number;
}

interface AuctionFinalizeEventRecord {
    target: string;
    eventType: string;
    payload: unknown;
    status: string;
    result: unknown;
}

const readSafeCloseTick = (closeTick: bigint | null): number | undefined => {
    if (closeTick === null) return undefined;
    const value = Number(closeTick);
    if (!Number.isSafeInteger(value)) {
        throw new Error(`Auction close tick is unsafe: ${closeTick}`);
    }
    return value;
};

export const buildAuctionFinalizeRequestId = (
    auctionId: number,
    deadline: AuctionFinalizeDeadline,
    retry = 0
): string => {
    const generation =
        deadline.closeTick === null ? deadline.closeAt.getTime().toString() : `tick:${deadline.closeTick.toString()}`;
    const base = `auction:finalize:${auctionId}:${generation}`;
    return retry > 0 ? `${base}:retry:${retry}` : base;
};

const buildLegacyAuctionFinalizeRequestId = (auctionId: number, closeAt: Date, retry = 0): string => {
    const base = `auction:finalize:${auctionId}:${closeAt.getTime()}`;
    return retry > 0 ? `${base}:retry:${retry}` : base;
};

const buildAuctionFinalizeCommand = (
    auctionId: number,
    deadline: AuctionFinalizeDeadline,
    requestId: string
): AuctionFinalizeCommand => ({
    type: 'auctionFinalize',
    requestId,
    auctionId,
    expectedCloseAt: deadline.closeAt.toISOString(),
    ...(deadline.closeTick === null ? {} : { expectedCloseTick: readSafeCloseTick(deadline.closeTick) }),
});

const isMatchingAuctionFinalizeEvent = (
    event: { target: string; eventType: string; payload: unknown },
    command: AuctionFinalizeCommand
): boolean => {
    const payload = event.payload;
    const payloadRecord =
        payload !== null && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as Record<string, unknown>)
            : null;
    const expectedGenerationMatches =
        payloadRecord?.expectedCloseTick !== undefined
            ? payloadRecord.expectedCloseTick === command.expectedCloseTick
            : payloadRecord?.expectedCloseAt === undefined || payloadRecord.expectedCloseAt === command.expectedCloseAt;
    return (
        event.target === 'ENGINE' &&
        event.eventType === command.type &&
        payloadRecord?.type === command.type &&
        payloadRecord.requestId === command.requestId &&
        payloadRecord.auctionId === command.auctionId &&
        expectedGenerationMatches
    );
};

const isSuccessfulAuctionFinalizeResult = (result: unknown, auctionId: number): boolean => {
    if (result === null || typeof result !== 'object' || Array.isArray(result)) return false;
    const resultRecord = result as Record<string, unknown>;
    return resultRecord.type === 'auctionFinalize' && resultRecord.ok === true && resultRecord.auctionId === auctionId;
};

export const popDueAuctionIds = async (
    redis: RedisTimerClient,
    timerKey: string,
    nowMs: number,
    batchSize: number,
    clockFence?: {
        activeRevisionKey: string;
        deadlineGenerationKey: string;
        phaseKey: string;
        revision: number;
        generation: number;
    }
): Promise<string[]> => {
    if (clockFence) {
        if (!redis.eval) throw new Error('Redis EVAL is required for revision-fenced auction due-pop.');
        const result = await redis.eval(POP_DUE_AUCTIONS_SCRIPT, {
            keys: [timerKey, clockFence.activeRevisionKey, clockFence.deadlineGenerationKey, clockFence.phaseKey],
            arguments: [String(clockFence.revision), String(clockFence.generation), String(nowMs), String(batchSize)],
        });
        if (!Array.isArray(result)) throw new Error('Auction due-pop returned an invalid Redis result.');
        if (result[0] === '__CLOCK_FENCE__') return [];
        return result.map(String);
    }
    const ids = await redis.zRangeByScore(timerKey, 0, nowMs, { LIMIT: { offset: 0, count: batchSize } });
    if (ids.length > 0) {
        await redis.zRem(timerKey, ids);
    }
    return ids;
};

const getNextDueMs = async (redis: RedisTimerClient, timerKey: string): Promise<number | null> => {
    const next = await redis.zRangeWithScores(timerKey, 0, 0);
    if (!next.length) {
        return null;
    }
    return next[0]?.score ?? null;
};

export const reconcilePendingAuctionTimers = async (options: {
    db: Pick<GamePrismaClient, 'auction' | 'inputEvent'>;
    redis: Pick<RedisTimerClient, 'zAdd' | 'zRem'>;
    timerKey: string;
    auctionIds: readonly number[];
    gameTime: CurrentGameTime;
}): Promise<{ pendingIds: number[]; rescheduled: number }> => {
    const auctionIds = [...new Set(options.auctionIds)];
    if (auctionIds.length === 0) {
        return { pendingIds: [], rescheduled: 0 };
    }
    const rows = await options.db.auction.findMany({
        where: { id: { in: auctionIds } },
        select: { id: true, status: true, closeAt: true, closeTick: true },
    });
    const pendingIds: number[] = [];
    const timers: Array<{ score: number; value: string }> = [];
    for (const row of rows) {
        if (row.status !== 'OPEN' && row.status !== 'FINALIZING') {
            continue;
        }
        const deadline = { closeAt: row.closeAt, closeTick: row.closeTick };
        const canonicalBase = buildAuctionFinalizeRequestId(row.id, deadline);
        const legacyBase = buildLegacyAuctionFinalizeRequestId(row.id, row.closeAt);
        const bases = [...new Set([canonicalBase, legacyBase])];
        const events = await options.db.inputEvent.findMany({
            where: {
                OR: bases.flatMap((base) => [{ requestId: base }, { requestId: { startsWith: `${base}:retry:` } }]),
            },
            select: { requestId: true, target: true, eventType: true, payload: true, status: true },
            orderBy: { sequence: 'desc' },
        });
        const hasPendingCurrentGeneration = events.some((event) => {
            if (event.status !== 'PENDING' && event.status !== 'PROCESSING') return false;
            return isMatchingAuctionFinalizeEvent(
                event,
                buildAuctionFinalizeCommand(row.id, deadline, event.requestId)
            );
        });
        if (hasPendingCurrentGeneration) {
            pendingIds.push(row.id);
            continue;
        }
        timers.push({
            score:
                row.status === 'FINALIZING'
                    ? (options.gameTime.tick ?? options.gameTime.now.getTime())
                    : resolveAuctionTimerScore(options.gameTime, row.closeAt, row.closeTick),
            value: String(row.id),
        });
    }
    if (pendingIds.length > 0) {
        await options.redis.zRem(options.timerKey, pendingIds.map(String));
    }
    if (timers.length > 0) {
        await options.redis.zAdd(options.timerKey, timers);
    }
    return { pendingIds, rescheduled: timers.length };
};

export const processDueAuctionId = async (options: {
    db: GamePrismaClient;
    redis: RedisTimerClient;
    timerKey: string;
    historyKey: string;
    id: string;
    nowMs: number;
    nowTick?: number | null;
    historyNowMs?: number;
    expectedClockRevision?: number;
    expectedDeadlineGeneration?: number;
}): Promise<'PENDING' | 'RESCHEDULED' | 'IGNORED'> => {
    const { db, redis, timerKey, historyKey, id, nowMs, nowTick = null, historyNowMs = nowMs } = options;
    const auctionId = Number(id);
    if (!Number.isSafeInteger(auctionId) || auctionId < 1) {
        return 'IGNORED';
    }
    const now = new Date(nowMs);
    const outcome = await db.$transaction(async (transaction) => {
        if (options.expectedClockRevision !== undefined || options.expectedDeadlineGeneration !== undefined) {
            await acquireGameSchemaAdvisoryXactLock(transaction, CLOCK_OPERATION_PERSISTENCE_LOCK);
            const [world] = await transaction.$queryRaw<
                Array<{ clockPhase: string | null; clockRevision: bigint; deadlineGeneration: bigint }>
            >(GamePrisma.sql`
                SELECT
                    clock_phase AS "clockPhase",
                    clock_revision AS "clockRevision",
                    deadline_generation AS "deadlineGeneration"
                FROM world_state
                ORDER BY id ASC
                LIMIT 1
                FOR UPDATE
            `);
            if (
                !world ||
                world.clockPhase !== 'RUNNING' ||
                world.clockRevision !== BigInt(options.expectedClockRevision ?? -1) ||
                world.deadlineGeneration !== BigInt(options.expectedDeadlineGeneration ?? -1)
            ) {
                return { status: 'RESCHEDULED' as const, clockFenceFailed: true };
            }
        }
        const current = await transaction.auction.findUnique({
            where: { id: auctionId },
            select: { status: true, closeAt: true, closeTick: true },
        });
        if (!current) {
            return { status: 'IGNORED' as const };
        }
        if (current.status === 'OPEN') {
            const isDue =
                current.closeTick !== null && nowTick !== null
                    ? current.closeTick <= BigInt(nowTick)
                    : current.closeTick === null && current.closeAt.getTime() <= now.getTime();
            if (!isDue) {
                return { status: 'RESCHEDULED' as const, closeAt: current.closeAt, closeTick: current.closeTick };
            }
        }
        if (current.status !== 'OPEN' && current.status !== 'FINALIZING') {
            return { status: 'IGNORED' as const };
        }

        const deadline = { closeAt: current.closeAt, closeTick: current.closeTick };
        for (let retry = 0; retry <= AUCTION_FINALIZE_RECOVERY_LIMIT; retry += 1) {
            const requestId = buildAuctionFinalizeRequestId(auctionId, deadline, retry);
            const legacyRequestId = buildLegacyAuctionFinalizeRequestId(auctionId, current.closeAt, retry);
            const candidateRequestIds = [...new Set([requestId, legacyRequestId])];
            let existing: AuctionFinalizeEventRecord | null = null;
            let existingRequestId = requestId;
            for (const candidateRequestId of candidateRequestIds) {
                existing = await transaction.inputEvent.findUnique({
                    where: { requestId: candidateRequestId },
                    select: { target: true, eventType: true, payload: true, status: true, result: true },
                });
                if (existing) {
                    existingRequestId = candidateRequestId;
                    break;
                }
            }
            const command = buildAuctionFinalizeCommand(auctionId, deadline, existingRequestId);
            if (!existing) {
                const nextCommand = buildAuctionFinalizeCommand(auctionId, deadline, requestId);
                await transaction.inputEvent.create({
                    data: {
                        requestId,
                        target: 'ENGINE',
                        eventType: nextCommand.type,
                        payload: { ...nextCommand },
                        ...(nowTick === null ? {} : { acceptedGameTick: BigInt(nowTick) }),
                        ...(options.expectedClockRevision === undefined
                            ? {}
                            : { acceptedClockRevision: BigInt(options.expectedClockRevision) }),
                        ...(options.expectedDeadlineGeneration === undefined
                            ? {}
                            : { acceptedDeadlineGeneration: BigInt(options.expectedDeadlineGeneration) }),
                    },
                });
                return { status: 'PENDING' as const };
            }
            if (!isMatchingAuctionFinalizeEvent(existing, command)) {
                throw new Error(`Conflicting durable auction finalization event: ${existingRequestId}`);
            }
            if (existing.status === 'PENDING' || existing.status === 'PROCESSING') {
                return { status: 'PENDING' as const };
            }
            if (existing.status === 'SUCCEEDED' && isSuccessfulAuctionFinalizeResult(existing.result, auctionId)) {
                throw new Error(
                    `Auction remained ${current.status} after successful durable event: ${existingRequestId}`
                );
            }
        }
        throw new Error(`Auction finalization recovery exhausted: ${auctionId}`);
    });

    if (outcome.status === 'PENDING') {
        // history retention은 운영 경과시간 기준이며 게임의 논리 시각과 분리한다.
        await redis.zAdd(historyKey, [{ score: historyNowMs, value: id }]);
        return 'PENDING';
    }
    if (outcome.status === 'RESCHEDULED') {
        if ('clockFenceFailed' in outcome) {
            await redis.zAdd(timerKey, [{ score: nowTick ?? nowMs, value: id }]);
            return 'RESCHEDULED';
        }
        const gameTime = await loadCurrentGameTime(db, now);
        await redis.zAdd(timerKey, [
            {
                score: resolveAuctionTimerScore(gameTime, outcome.closeAt, outcome.closeTick),
                value: String(auctionId),
            },
        ]);
        return 'RESCHEDULED';
    }
    return 'IGNORED';
};

export interface AuctionWorkerOptions {
    signal?: AbortSignal;
}

export const runAuctionWorker = async (options: AuctionWorkerOptions = {}): Promise<void> => {
    const config = resolveGameApiConfigFromEnv();
    const postgres = createGamePostgresConnector(resolvePostgresConfigFromEnv({ schema: config.profile }));
    const redis = createRedisConnector(resolveRedisConfigFromEnv());

    await postgres.connect();
    await redis.connect();

    const keys = buildAuctionTimerKeys(config.profileName);
    const control = createPollingWorkerControl(options.signal);
    const closeResources = createBestEffortResourceCloser([
        { name: 'auction-worker-redis', run: () => redis.disconnect() },
        { name: 'auction-worker-postgres', run: () => postgres.disconnect() },
    ]);

    let nextResyncAt = Date.now();
    const pendingFinalizationIds = new Set<number>();

    try {
        while (!control.signal.aborted) {
            const operationalNowMs = Date.now();
            const gameTime = await loadCurrentGameTime(postgres.prisma, new Date(operationalNowMs));
            const gameNowMs = gameTime.now.getTime();
            const dueScore = gameTime.tick ?? gameNowMs;
            if (gameTime.phase && gameTime.phase !== 'RUNNING') {
                await waitForWorkerPoll(control.signal, config.auctionTimerPollMs);
                continue;
            }
            const clockFence = gameTime.phase
                ? await ensureActiveRedisClockFence(redis.client, config.profileName, gameTime)
                : null;
            if (gameTime.phase && !clockFence) {
                await waitForWorkerPoll(control.signal, config.auctionTimerPollMs);
                continue;
            }
            if (operationalNowMs >= nextResyncAt) {
                await seedAuctionTimers(postgres.prisma, redis.client, keys);
                nextResyncAt = operationalNowMs + config.auctionTimerResyncMs;
            }
            if (pendingFinalizationIds.size > 0) {
                const reconciliation = await reconcilePendingAuctionTimers({
                    db: postgres.prisma,
                    redis: redis.client,
                    timerKey: keys.timerKey,
                    auctionIds: [...pendingFinalizationIds],
                    gameTime,
                });
                pendingFinalizationIds.clear();
                for (const auctionId of reconciliation.pendingIds) {
                    pendingFinalizationIds.add(auctionId);
                }
            }
            const historyTrimBefore = operationalNowMs - config.auctionTimerRetentionSeconds * 1000;
            if (historyTrimBefore > 0) {
                await redis.client.zRemRangeByScore(keys.historyKey, 0, historyTrimBefore);
            }
            const dueIds = await popDueAuctionIds(redis.client, keys.timerKey, dueScore, 100, clockFence ?? undefined);
            if (dueIds.length > 0) {
                for (const id of dueIds) {
                    try {
                        const outcome = await processDueAuctionId({
                            db: postgres.prisma,
                            redis: redis.client,
                            timerKey: keys.timerKey,
                            historyKey: keys.historyKey,
                            id,
                            nowMs: gameNowMs,
                            nowTick: gameTime.tick,
                            historyNowMs: operationalNowMs,
                            ...(clockFence
                                ? {
                                      expectedClockRevision: clockFence.revision,
                                      expectedDeadlineGeneration: clockFence.generation,
                                  }
                                : {}),
                        });
                        if (outcome === 'PENDING') {
                            pendingFinalizationIds.add(Number(id));
                        }
                    } catch (error) {
                        const message = error instanceof Error ? error.message : 'Unknown auction worker error';
                        const trace = error instanceof Error ? error.stack : undefined;
                        try {
                            await postgres.prisma.errorLog.create({
                                data: {
                                    category: 'AUCTION',
                                    source: 'auction-worker',
                                    message,
                                    trace,
                                    context: { auctionId: id },
                                },
                            });
                        } catch (logError) {
                            console.error('[auction-worker] failed to record auction error', logError);
                        }
                    }
                }
                continue;
            }

            const nextDueMs = await getNextDueMs(redis.client, keys.timerKey);
            const waitMs =
                gameTime.tick === null && nextDueMs !== null
                    ? Math.max(0, Math.min(config.auctionTimerPollMs, nextDueMs - gameNowMs))
                    : config.auctionTimerPollMs;
            await waitForWorkerPoll(control.signal, waitMs);
        }
    } finally {
        control.dispose();
        await closeResources();
    }
};
