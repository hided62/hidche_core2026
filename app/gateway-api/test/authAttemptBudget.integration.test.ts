import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisAuthCounterStore } from '../src/auth/attemptBudget.js';

const redisUrl = process.env.GATEWAY_AUTH_REDIS_TEST_URL;

describe.skipIf(!redisUrl)('Redis authentication budget atomicity', () => {
    const client = createClient({ url: redisUrl });
    const prefix = `auth-budget-test:${randomUUID()}`;
    const store = new RedisAuthCounterStore(client);
    const keys = ['subject', 'global', 'expires', 'invalid'].map((kind) => `${prefix}:${kind}`);
    beforeAll(async () => {
        await client.connect();
    });
    afterAll(async () => {
        await client.del(keys);
        await client.quit();
    });

    it('admits exactly ten concurrent attempts and does not charge other buckets on rejection', async () => {
        const attempts = await Promise.all(
            Array.from({ length: 100 }, () =>
                store.consume([
                    { key: keys[0]!, limit: 10, windowMs: 60_000 },
                    { key: keys[1]!, limit: 1000, windowMs: 60_000 },
                ])
            )
        );
        expect(attempts.filter((retry) => retry === 0)).toHaveLength(10);
        expect(attempts.filter((retry) => retry > 0)).toHaveLength(90);
        expect(await client.get(keys[0]!)).toBe('10');
        expect(await client.get(keys[1]!)).toBe('10');
        expect(await client.pTTL(keys[0]!)).toBeGreaterThan(0);
    });

    it('keeps the original expiry under repeated rejected attempts and permits recovery', async () => {
        const counters = [{ key: keys[2]!, limit: 1, windowMs: 120 }];
        expect(await store.consume(counters)).toBe(0);
        const before = await client.pTTL(keys[2]!);
        expect(await store.consume(counters)).toBeGreaterThan(0);
        expect(await client.pTTL(keys[2]!)).toBeLessThanOrEqual(before);
        await expect.poll(() => client.exists(keys[2]!), { interval: 20, timeout: 1000 }).toBe(0);
        expect(await store.consume(counters)).toBe(0);
    });

    it('rejects a malformed counter without an expiry instead of permanently locking the account', async () => {
        await client.set(keys[3]!, '10');
        await expect(store.consume([{ key: keys[3]!, limit: 10, windowMs: 60_000 }])).rejects.toMatchObject({
            reason: 'unavailable',
        });
    });
});
