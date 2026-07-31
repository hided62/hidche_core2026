import { describe, expect, it, vi } from 'vitest';

import { InMemoryFlushStore, RedisGatewayFlushSubscriber } from '../src/auth/flushStore.js';

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
