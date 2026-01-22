import {
    createGamePostgresConnector,
    createRedisConnector,
    GamePrisma,
    resolvePostgresConfigFromEnv,
    resolveRedisConfigFromEnv,
} from '@sammo-ts/infra';

import { resolveGameApiConfigFromEnv } from '../config.js';
import { RedisTurnDaemonTransport } from '../daemon/redisTransport.js';
import { buildTurnDaemonStreamKeys } from '../daemon/streamKeys.js';
import { buildAuctionTimerKeys } from './keys.js';
import { seedAuctionTimers } from './scheduler.js';

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

const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

export const runAuctionWorker = async (): Promise<void> => {
    const config = resolveGameApiConfigFromEnv();
    const postgres = createGamePostgresConnector(resolvePostgresConfigFromEnv({ schema: config.profile }));
    const redis = createRedisConnector(resolveRedisConfigFromEnv());

    await postgres.connect();
    await redis.connect();

    const keys = buildAuctionTimerKeys(config.profileName);
    const daemonTransport = new RedisTurnDaemonTransport(redis.client, {
        keys: buildTurnDaemonStreamKeys(config.profileName),
        requestTimeoutMs: config.daemonRequestTimeoutMs,
    });

    const handleExit = async () => {
        await redis.disconnect();
        await postgres.disconnect();
    };
    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);

    let nextResyncAt = Date.now();

    while (true) {
        const nowMs = Date.now();
        const historyTrimBefore = nowMs - config.auctionTimerRetentionSeconds * 1000;
        if (historyTrimBefore > 0) {
            await redis.client.zRemRangeByScore(keys.historyKey, 0, historyTrimBefore);
        }
        if (nowMs >= nextResyncAt) {
            await seedAuctionTimers(postgres.prisma, redis.client, keys);
            nextResyncAt = nowMs + config.auctionTimerResyncMs;
        }

        const dueIds = await popDueAuctionIds(redis.client, keys.timerKey, nowMs, 100);
        if (dueIds.length > 0) {
            const now = new Date(nowMs);
            await redis.client.zAdd(
                keys.historyKey,
                dueIds.map((id) => ({ score: nowMs, value: id }))
            );
            for (const id of dueIds) {
                const auctionId = Number(id);
                if (!Number.isFinite(auctionId)) {
                    continue;
                }

                const updated = await postgres.prisma.$executeRaw(
                    GamePrisma.sql`
                        UPDATE auction
                        SET status = 'FINALIZING',
                            finalizing_at = ${now},
                            updated_at = ${now}
                        WHERE id = ${auctionId}
                          AND status = 'OPEN'
                          AND close_at <= ${now}
                    `
                );

                if (updated > 0) {
                    await daemonTransport.sendCommand({ type: 'auctionFinalize', auctionId });
                }
            }
            continue;
        }

        const nextDueMs = await getNextDueMs(redis.client, keys.timerKey);
        if (nextDueMs === null) {
            await sleepMs(config.auctionTimerPollMs);
            continue;
        }

        const waitMs = Math.max(0, Math.min(config.auctionTimerPollMs, nextDueMs - Date.now()));
        await sleepMs(waitMs);
    }
};
