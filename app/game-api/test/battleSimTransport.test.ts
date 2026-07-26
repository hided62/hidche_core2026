import { describe, expect, it } from 'vitest';

import { buildBattleSimQueueKeys } from '../src/battleSim/keys.js';
import { RedisBattleSimTransport } from '../src/battleSim/redisTransport.js';
import type { BattleSimJob, BattleSimJobPayload } from '../src/battleSim/types.js';

class FakeRedisClient {
    readonly values = new Map<string, string>();
    readonly lists = new Map<string, string[]>();

    async rPush(key: string, value: string): Promise<number> {
        const list = this.lists.get(key) ?? [];
        list.push(value);
        this.lists.set(key, list);
        return list.length;
    }

    async blPop(): Promise<null> {
        return null;
    }

    async set(key: string, value: string): Promise<'OK'> {
        this.values.set(key, value);
        return 'OK';
    }

    async get(key: string): Promise<string | null> {
        return this.values.get(key) ?? null;
    }

    async expire(): Promise<number> {
        return 1;
    }
}

describe('RedisBattleSimTransport requester isolation', () => {
    it('records the requester on queued jobs and scopes completed results to that user', async () => {
        const client = new FakeRedisClient();
        const keys = buildBattleSimQueueKeys('che:test');
        const transport = new RedisBattleSimTransport(client, {
            keys,
            requestTimeoutMs: 1,
            resultTtlSeconds: 60,
        });

        const response = await transport.simulate({} as BattleSimJobPayload, 'user/one');
        expect(response.status).toBe('queued');

        const queuedRaw = client.lists.get(keys.queueKey)?.[0];
        expect(queuedRaw).toBeTruthy();
        expect(JSON.parse(queuedRaw ?? '{}') as BattleSimJob).toMatchObject({
            jobId: response.jobId,
            requesterUserId: 'user/one',
        });

        await transport.pushResult(response.jobId, 'user/one', {
            result: true,
            reason: 'success',
            avgWar: 3,
        });

        await expect(transport.getSimulationResult(response.jobId, 'user/one')).resolves.toMatchObject({
            result: true,
            avgWar: 3,
        });
        await expect(transport.getSimulationResult(response.jobId, 'user/two')).resolves.toBeNull();
        expect(Array.from(client.values.keys()).some((key) => key.includes('user%2Fone'))).toBe(true);
    });
});
