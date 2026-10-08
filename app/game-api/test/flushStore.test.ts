import { createServer, type Socket } from 'node:net';
import { createClient } from 'redis';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryFlushStore, RedisFlushStore, RedisGatewayFlushSubscriber } from '../src/auth/flushStore.js';

describe('RedisGatewayFlushSubscriber', () => {
    it('reports asynchronous flush handler failures with event context', async () => {
        let listener: ((message: string) => void) | undefined;
        const client = {
            subscribe: vi.fn(async (_channel: string, next: (message: string) => void) => {
                listener = next;
            }),
            unsubscribe: vi.fn(async () => undefined),
        };
        const error = new Error('durable enqueue unavailable');
        const onError = vi.fn();
        const subscriber = new RedisGatewayFlushSubscriber(
            client,
            'flush',
            new InMemoryFlushStore(),
            async () => Promise.reject(error),
            onError
        );
        await subscriber.start();
        const event = {
            userId: 'user-1',
            flushedAt: '2026-07-31T09:00:00.001Z',
            reason: 'admin-profile-icon-reset',
            iconRevision: '2026-07-31T09:00:00.001Z',
        };

        listener?.(JSON.stringify(event));

        await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error, event));
        await subscriber.stop();
    });

    it('unsubscribes and drains an in-flight durable flush before stopping', async () => {
        let listener: ((message: string) => void) | undefined;
        let release: (() => void) | undefined;
        const client = {
            subscribe: vi.fn(async (_channel: string, next: (message: string) => void) => {
                listener = next;
            }),
            unsubscribe: vi.fn(async () => undefined),
        };
        const onFlush = vi.fn(
            async () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                })
        );
        const subscriber = new RedisGatewayFlushSubscriber(client, 'flush', new InMemoryFlushStore(), onFlush);
        await subscriber.start();

        listener?.(JSON.stringify({ userId: 'user-1', flushedAt: '2026-07-31T09:00:00.001Z' }));
        await vi.waitFor(() => expect(onFlush).toHaveBeenCalledOnce());
        let stopped = false;
        const stopping = subscriber.stop().then(() => {
            stopped = true;
        });
        await vi.waitFor(() => expect(client.unsubscribe).toHaveBeenCalledOnce());
        expect(stopped).toBe(false);

        release?.();
        await stopping;
        expect(stopped).toBe(true);
    });
});

describe('RedisFlushStore authorization state', () => {
    it('merges startup, persistent and local watermarks without caching an allow result', async () => {
        let persisted: string | null = null;
        const mGet = vi.fn(async (keys: string[]) => (keys.length === 1 ? ['100'] : ['100', persisted]));
        const store = new RedisFlushStore({ mGet }, 'fixture:flush');
        await store.assertInitialized();
        expect((await store.getFlushedAt('user-1'))?.getTime()).toBe(100);
        persisted = '200';
        expect((await store.getFlushedAt('user-1'))?.getTime()).toBe(200);
        store.applyFlush({ userId: 'user-1', flushedAt: new Date(300).toISOString() });
        expect((await store.getFlushedAt('user-1'))?.getTime()).toBe(300);
        expect(mGet).toHaveBeenCalledTimes(4);
    });
    it('retains revocation after local cache eviction and a fresh store instance', async () => {
        const client = { mGet: async (keys: string[]) => (keys.length === 1 ? ['0'] : ['0', '200']) };
        const store = new RedisFlushStore(client, 'fixture:flush');
        for (let i = 0; i < 4100; i++)
            store.applyFlush({ userId: `user-${i}`, flushedAt: new Date(100).toISOString() });
        expect((await store.getFlushedAt('user-0'))?.getTime()).toBe(200);
        expect((await new RedisFlushStore(client, 'fixture:flush').getFlushedAt('user-0'))?.getTime()).toBe(200);
    });
    it.each([null, '', 'invalid', '-1', '8640000000000001'])(
        'rejects missing or corrupt initialization %s',
        async (baseline) => {
            const store = new RedisFlushStore({ mGet: async () => [baseline] }, 'fixture:flush');
            await expect(store.assertInitialized()).rejects.toThrow();
        }
    );
    it('rejects corrupted per-user state instead of treating it as never revoked', async () => {
        const store = new RedisFlushStore({ mGet: async () => ['0', 'not-a-watermark'] }, 'fixture:flush');
        await expect(store.getFlushedAt('user-1')).rejects.toThrow();
    });
    it('does not perform an offline read and bounds a connected read with an abort signal', async () => {
        const offlineGet = vi.fn(async () => ['0', null]);
        const offline = new RedisFlushStore({ isReady: false, mGet: offlineGet }, 'fixture:flush');
        await expect(offline.getFlushedAt('user')).rejects.toThrow('unavailable');
        expect(offlineGet).not.toHaveBeenCalled();
        const mGet = vi.fn(async () => ['0', '100']);
        const withAbortSignal = vi.fn((_signal: AbortSignal) => ({ mGet }));
        const store = new RedisFlushStore({ mGet, withAbortSignal }, 'fixture:flush');
        expect((await store.getFlushedAt('user'))?.getTime()).toBe(100);
        expect(withAbortSignal.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    });
});

it('bounds a connected Redis read when the actual TCP peer stops replying', async () => {
    const sockets = new Set<Socket>();
    let receivedRead = false;
    const server = createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('data', (data) => {
            const request = data.toString();
            // Real node-redis handshake succeeds; its MGET command receives no reply.
            if (request.includes('MGET')) {
                receivedRead = true;
                return;
            }
            const count = [...request.matchAll(/\*\d+\r\n/g)].length;
            socket.write('+OK\r\n'.repeat(count));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP fixture address');
    const client = createClient({ socket: { host: '127.0.0.1', port: address.port, reconnectStrategy: false } });
    try {
        await client.connect();
        expect(client.isReady).toBe(true);
        const start = Date.now();
        await expect(new RedisFlushStore(client, 'fixture:flush').getFlushedAt('user')).rejects.toThrow();
        expect(receivedRead).toBe(true);
        expect(Date.now() - start).toBeGreaterThanOrEqual(1800);
        expect(Date.now() - start).toBeLessThan(4500);
    } finally {
        if (client.isOpen) client.destroy();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
});
