import { createRedisConnector, resolveRedisConfigFromEnv } from '@sammo-ts/infra';

import { resolveGameApiConfigFromEnv } from '../config.js';
import { buildBattleSimQueueKeys } from './keys.js';
import { processBattleSimJob } from './processor.js';
import { RedisBattleSimTransport } from './redisTransport.js';
import type { BattleSimJob } from './types.js';

type RedisBlPopResult = { key: string; element: string } | [string, string] | null;

const parseBlPopValue = (result: RedisBlPopResult): string | null => {
    if (!result) {
        return null;
    }
    if (Array.isArray(result)) {
        return result[1] ?? null;
    }
    return result.element ?? null;
};

export const runBattleSimWorker = async (): Promise<void> => {
    const config = resolveGameApiConfigFromEnv();
    const redis = createRedisConnector(resolveRedisConfigFromEnv());
    await redis.connect();

    const keys = buildBattleSimQueueKeys(config.profileName);
    const transport = new RedisBattleSimTransport(redis.client, {
        keys,
        requestTimeoutMs: config.battleSimRequestTimeoutMs,
        resultTtlSeconds: config.battleSimResultTtlSeconds,
    });

    const handleExit = async () => {
        await redis.disconnect();
    };
    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);

    while (true) {
        const item = await redis.client.blPop(keys.queueKey, 0);
        const raw = parseBlPopValue(item);
        if (!raw) {
            continue;
        }

        let job: BattleSimJob | null = null;
        try {
            job = JSON.parse(raw) as BattleSimJob;
        } catch {
            continue;
        }

        try {
            const result = processBattleSimJob(job.payload);
            await transport.pushResult(job.jobId, result);
        } catch (error) {
            const reason = error instanceof Error ? error.message : '전투 시뮬레이션 오류';
            await transport.pushResult(job.jobId, {
                result: false,
                reason,
            });
        }
    }
};
