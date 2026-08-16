import { describe, expect, it, vi } from 'vitest';

import type { RedisConnector } from '@sammo-ts/infra';
import type { ReadModelOutboxDatabase } from '@sammo-ts/infra';

import { ReadModelOutboxWorker } from '../src/realtime/outboxWorker.js';

const payload = (domain: 'front.general' | 'access.general' | 'tournament' | 'betting') => ({
    version: 1,
    changes: [[domain, domain === 'front.general' || domain === 'access.general' ? 7 : 0, '1']],
});

const createFixture = (rows: readonly object[]) => {
    const queryRaw = vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const incr = vi.fn().mockResolvedValue(41);
    const publish = vi.fn().mockResolvedValue(1);
    const db = {
        $queryRaw: queryRaw,
        readModelOutbox: { updateMany },
    } as unknown as ReadModelOutboxDatabase;
    const redis = { incr, publish } as unknown as RedisConnector['client'];
    return { db, redis, queryRaw, updateMany, incr, publish };
};

describe('ReadModelOutboxWorker', () => {
    it('publishes a legacy internal readModelChanged event and acknowledges the durable row', async () => {
        const fixture = createFixture([{ id: 11n, payload: payload('front.general'), attempts: 1 }]);
        const worker = new ReadModelOutboxWorker(fixture.db, fixture.redis, 'che:default', {
            owner: 'worker-test',
            intervalMs: 60_000,
        });

        worker.start();
        await vi.waitFor(() => expect(fixture.updateMany).toHaveBeenCalledTimes(1));
        await worker.stop();

        expect(fixture.incr).toHaveBeenCalledWith('sammo:che:default:read-model:revision');
        const event = JSON.parse(String(fixture.publish.mock.calls[0]?.[1]));
        expect(event).toMatchObject({
            type: 'readModelChanged',
            revision: 41,
            changes: { frontStatusActorIds: [7] },
        });
        expect(fixture.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 11n, lockOwner: 'worker-test', deliveredAt: null } })
        );
    });

    it.each(['access.general', 'tournament', 'betting'] as const)(
        'marks a %s-only envelope delivered without dashboard Redis publish',
        async (domain) => {
            const fixture = createFixture([{ id: 12n, payload: payload(domain), attempts: 1 }]);
            const worker = new ReadModelOutboxWorker(fixture.db, fixture.redis, 'che:default', {
                owner: 'worker-test',
                intervalMs: 60_000,
            });

            worker.start();
            await vi.waitFor(() => expect(fixture.updateMany).toHaveBeenCalledTimes(1));
            await worker.stop();

            expect(fixture.incr).not.toHaveBeenCalled();
            expect(fixture.publish).not.toHaveBeenCalled();
        }
    );

    it('coalesces repeated wakeups into one trailing batch and waits for it on shutdown', async () => {
        let releaseFirst: (() => void) | undefined;
        const first = new Promise<readonly object[]>((resolve) => {
            releaseFirst = () => resolve([]);
        });
        const fixture = createFixture([]);
        fixture.queryRaw.mockReset();
        fixture.queryRaw.mockReturnValueOnce(first).mockResolvedValue([]);
        const worker = new ReadModelOutboxWorker(fixture.db, fixture.redis, 'che:default', {
            owner: 'worker-test',
            intervalMs: 60_000,
        });

        worker.start();
        worker.wake();
        worker.wake();
        expect(fixture.queryRaw).toHaveBeenCalledTimes(1);

        releaseFirst?.();
        await vi.waitFor(() => expect(fixture.queryRaw).toHaveBeenCalledTimes(2));
        await worker.stop();
        expect(fixture.queryRaw).toHaveBeenCalledTimes(2);
    });

    it('reports item failures while leaving the row released for dispatcher retry', async () => {
        const fixture = createFixture([{ id: 13n, payload: payload('front.general'), attempts: 1 }]);
        fixture.publish.mockRejectedValueOnce(new Error('redis unavailable'));
        const onError = vi.fn();
        const worker = new ReadModelOutboxWorker(fixture.db, fixture.redis, 'che:default', {
            owner: 'worker-test',
            intervalMs: 60_000,
            onError,
        });

        worker.start();
        await vi.waitFor(() => expect(fixture.updateMany).toHaveBeenCalledTimes(1));
        await worker.stop();

        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ message: '1 read-model outbox delivery attempt(s) failed.' })
        );
        expect(fixture.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 13n, lockOwner: 'worker-test', deliveredAt: null },
                data: expect.objectContaining({
                    lockedAt: null,
                    lockOwner: null,
                    lastError: expect.stringContaining('redis unavailable'),
                }),
            })
        );
    });

    it('prunes only a bounded retention batch on the lower-frequency cadence', async () => {
        let now = new Date('2026-08-16T00:00:00.000Z');
        const fixture = createFixture([]);
        const worker = new ReadModelOutboxWorker(fixture.db, fixture.redis, 'che:default', {
            owner: 'worker-test',
            intervalMs: 60_000,
            retentionMs: 24 * 60 * 60 * 1_000,
            pruneIntervalMs: 60_000,
            pruneLimit: 100,
            now: () => now,
        });
        now = new Date('2026-08-16T00:01:00.000Z');

        worker.start();
        await vi.waitFor(() => expect(fixture.queryRaw).toHaveBeenCalledTimes(2));
        await worker.stop();

        const pruneQuery = fixture.queryRaw.mock.calls[1]?.[0] as { sql: string; values: unknown[] };
        expect(pruneQuery.sql).toContain('DELETE FROM "read_model_outbox"');
        expect(pruneQuery.values).toContainEqual(new Date('2026-08-15T00:01:00.000Z'));
        expect(pruneQuery.values).toContain(100);
    });
});
