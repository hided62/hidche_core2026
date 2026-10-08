import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    buildSessionRevocationBaselineKey,
    buildUserSessionRevocationKey,
} from '@sammo-ts/common/auth/sessionRevocation';
import { RedisGatewayFlushPublisher } from '../src/auth/flushPublisher.js';

const url = process.env.GATEWAY_SESSION_REDIS_TEST_URL;
describe.skipIf(!url)('persistent Gateway flush over real Redis', () => {
    const client = createClient({ url });
    const channel = `revocation-publisher-test:${randomUUID()}:flush`;
    const publisher = new RedisGatewayFlushPublisher(client, channel);
    beforeAll(async () => {
        await client.connect();
    });
    afterAll(async () => {
        for await (const keys of client.scanIterator({ MATCH: `${channel}:*`, COUNT: 100 }))
            if (keys.length) await client.del(keys);
        await client.quit();
    });
    it('initializes once and preserves the original cutoff across publisher restarts', async () => {
        await publisher.initialize();
        const baseline = await client.get(buildSessionRevocationBaselineKey(channel));
        expect(Number(baseline)).toBeGreaterThan(0);
        await new RedisGatewayFlushPublisher(client, channel).initialize();
        expect(await client.get(buildSessionRevocationBaselineKey(channel))).toBe(baseline);
        expect(await client.pTTL(buildSessionRevocationBaselineKey(channel))).toBe(-1);
    });
    it('persists a revocation when there are zero subscribers', async () => {
        const userId = randomUUID();
        await publisher.publishUserFlush(userId, 'logout');
        expect(Number(await client.get(buildUserSessionRevocationKey(channel, userId)))).toBeGreaterThan(0);
        expect(await client.pTTL(buildUserSessionRevocationKey(channel, userId))).toBe(-1);
    });
    it('makes the watermark readable before delivering flush metadata', async () => {
        const subscriber = client.duplicate();
        await subscriber.connect();
        const userId = randomUUID();
        let delivered: { event: Record<string, unknown>; persisted: string | null } | undefined;
        await subscriber.subscribe(channel, async (raw) => {
            delivered = {
                event: JSON.parse(raw) as Record<string, unknown>,
                persisted: await client.get(buildUserSessionRevocationKey(channel, userId)),
            };
        });
        try {
            await publisher.publishUserFlush(userId, 'identity-updated', {
                displayName: 'fixture',
                identityRevision: 'revision-1',
            });
            await vi.waitFor(() => expect(delivered).toBeDefined());
            expect(delivered!.event).toMatchObject({
                userId,
                reason: 'identity-updated',
                displayName: 'fixture',
                identityRevision: 'revision-1',
            });
            expect(Number(delivered!.persisted)).toBe(Date.parse(delivered!.event.flushedAt as string));
        } finally {
            await subscriber.unsubscribe(channel);
            await subscriber.quit();
        }
    });
    it('never moves a newer watermark backwards under late or concurrent flushes', async () => {
        const userId = randomUUID();
        const future = String(Date.now() + 60_000);
        await client.set(buildUserSessionRevocationKey(channel, userId), future);
        await Promise.all(Array.from({ length: 8 }, () => publisher.publishUserFlush(userId, 'concurrent')));
        expect(await client.get(buildUserSessionRevocationKey(channel, userId))).toBe(future);
    });
    it('fails closed for an unavailable client instead of publishing without storage', async () => {
        const offline = client.duplicate();
        const closed = new RedisGatewayFlushPublisher(offline, channel);
        await expect(closed.initialize()).rejects.toThrow('unavailable');
        await expect(closed.publishUserFlush(randomUUID(), 'logout')).rejects.toThrow('unavailable');
    });
});
