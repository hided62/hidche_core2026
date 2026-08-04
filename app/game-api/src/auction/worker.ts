import {
    createGamePostgresConnector,
    createRedisConnector,
    GamePrisma,
    type GamePrismaClient,
    resolvePostgresConfigFromEnv,
    resolveRedisConfigFromEnv,
} from '@sammo-ts/infra';

import { resolveGameApiConfigFromEnv } from '../config.js';
import { createBestEffortResourceCloser } from '../services/bestEffortResourceCloser.js';
import { loadCurrentGameTime } from '../services/gameClock.js';
import { createPollingWorkerControl, waitForWorkerPoll } from '../services/pollingWorkerLifecycle.js';
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
}

const AUCTION_FINALIZE_RECOVERY_LIMIT = 1;

const buildAuctionFinalizeRequestId = (auctionId: number, closeAt: Date, retry = 0): string => {
    const generation = closeAt.getTime();
    const base = `auction:finalize:${auctionId}:${generation}`;
    return retry > 0 ? `${base}:retry:${retry}` : base;
};

const isMatchingAuctionFinalizeEvent = (
    event: { target: string; eventType: string; payload: unknown },
    command: { type: 'auctionFinalize'; requestId: string; auctionId: number }
): boolean => {
    const payload = event.payload;
    const payloadRecord =
        payload !== null && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as Record<string, unknown>)
            : null;
    return (
        event.target === 'ENGINE' &&
        event.eventType === command.type &&
        payloadRecord?.type === command.type &&
        payloadRecord.requestId === command.requestId &&
        payloadRecord.auctionId === command.auctionId
    );
};

const isSuccessfulAuctionFinalizeResult = (result: unknown, auctionId: number): boolean => {
    if (result === null || typeof result !== 'object' || Array.isArray(result)) return false;
    const resultRecord = result as Record<string, unknown>;
    return resultRecord.type === 'auctionFinalize' && resultRecord.ok === true && resultRecord.auctionId === auctionId;
};

const popDueAuctionIds = async (
    redis: RedisTimerClient,
    timerKey: string,
    nowMs: number,
    batchSize: number
): Promise<string[]> => {
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

export const processDueAuctionId = async (options: {
    db: GamePrismaClient;
    redis: RedisTimerClient;
    timerKey: string;
    historyKey: string;
    id: string;
    nowMs: number;
    nowTick?: number | null;
}): Promise<'FINALIZING' | 'RESCHEDULED' | 'IGNORED'> => {
    const { db, redis, timerKey, historyKey, id, nowMs, nowTick = null } = options;
    const auctionId = Number(id);
    if (!Number.isSafeInteger(auctionId) || auctionId < 1) {
        return 'IGNORED';
    }
    const now = new Date(nowMs);
    const outcome = await db.$transaction(async (transaction) => {
        const updated = await transaction.$executeRaw(
            GamePrisma.sql`
                UPDATE auction
                SET status = 'FINALIZING',
                    finalizing_at = ${now},
                    updated_at = ${now}
                WHERE id = ${auctionId}
                  AND status = 'OPEN'
                  AND (
                      (close_tick IS NOT NULL AND close_tick <= ${nowTick === null ? null : BigInt(nowTick)})
                      OR (close_tick IS NULL AND close_at <= ${now})
                  )
            `
        );

        const current = await transaction.auction.findUnique({
            where: { id: auctionId },
            select: { status: true, closeAt: true, closeTick: true },
        });
        if (!current) {
            if (updated > 0) {
                throw new Error(`Auction disappeared after FINALIZING transition: ${auctionId}`);
            }
            return { status: 'IGNORED' as const };
        }
        if (current.status === 'OPEN') {
            return { status: 'RESCHEDULED' as const, closeAt: current.closeAt, closeTick: current.closeTick };
        }
        if (current.status !== 'FINALIZING') {
            return { status: 'IGNORED' as const };
        }

        for (let retry = 0; retry <= AUCTION_FINALIZE_RECOVERY_LIMIT; retry += 1) {
            const requestId = buildAuctionFinalizeRequestId(auctionId, current.closeAt, retry);
            const command = { type: 'auctionFinalize' as const, requestId, auctionId };
            const existing = await transaction.inputEvent.findUnique({
                where: { requestId },
                select: { target: true, eventType: true, payload: true, status: true, result: true },
            });
            if (!existing) {
                await transaction.inputEvent.create({
                    data: {
                        requestId,
                        target: 'ENGINE',
                        eventType: command.type,
                        payload: command,
                    },
                });
                return { status: 'FINALIZING' as const };
            }
            if (!isMatchingAuctionFinalizeEvent(existing, command)) {
                throw new Error(`Conflicting durable auction finalization event: ${requestId}`);
            }
            if (existing.status === 'PENDING' || existing.status === 'PROCESSING') {
                return { status: 'FINALIZING' as const };
            }
            if (existing.status === 'SUCCEEDED' && isSuccessfulAuctionFinalizeResult(existing.result, auctionId)) {
                throw new Error(`Auction remained FINALIZING after successful durable event: ${requestId}`);
            }
        }
        throw new Error(`Auction finalization recovery exhausted: ${auctionId}`);
    });

    if (outcome.status === 'FINALIZING') {
        await redis.zAdd(historyKey, [{ score: nowMs, value: id }]);
        return 'FINALIZING';
    }
    if (outcome.status === 'RESCHEDULED') {
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

    try {
        while (!control.signal.aborted) {
            const operationalNowMs = Date.now();
            const gameTime = await loadCurrentGameTime(postgres.prisma, new Date(operationalNowMs));
            const gameNowMs = gameTime.now.getTime();
            const dueScore = gameTime.tick ?? gameNowMs;
            const historyTrimBefore = operationalNowMs - config.auctionTimerRetentionSeconds * 1000;
            if (historyTrimBefore > 0) {
                await redis.client.zRemRangeByScore(keys.historyKey, 0, historyTrimBefore);
            }
            if (operationalNowMs >= nextResyncAt) {
                await seedAuctionTimers(postgres.prisma, redis.client, keys);
                nextResyncAt = operationalNowMs + config.auctionTimerResyncMs;
            }

            const dueIds = await popDueAuctionIds(redis.client, keys.timerKey, dueScore, 100);
            if (dueIds.length > 0) {
                for (const id of dueIds) {
                    try {
                        await processDueAuctionId({
                            db: postgres.prisma,
                            redis: redis.client,
                            timerKey: keys.timerKey,
                            historyKey: keys.historyKey,
                            id,
                            nowMs: gameNowMs,
                            nowTick: gameTime.tick,
                        });
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
