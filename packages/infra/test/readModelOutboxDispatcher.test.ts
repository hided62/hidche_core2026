import { describe, expect, it, vi } from 'vitest';

import type { GamePrismaClient } from '../src/gamePrisma.js';
import {
    claimReadModelOutboxBatch,
    dispatchReadModelOutboxBatch,
    pruneDeliveredReadModelOutbox,
} from '../src/readModelOutboxDispatcher.js';

const validPayload = {
    version: 1,
    changes: [['general.content', 7, '3']],
};

const createDb = (rows: readonly object[]) => {
    const queryRaw = vi.fn().mockResolvedValue(rows);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    return {
        db: { $queryRaw: queryRaw, readModelOutbox: { updateMany } } as unknown as GamePrismaClient,
        queryRaw,
        updateMany,
    };
};

describe('read-model outbox dispatcher', () => {
    it('claims a bounded lease with one statement and preserves delivery identity', async () => {
        const fixture = createDb([{ id: 41n, payload: validPayload, attempts: 2 }]);
        await expect(
            claimReadModelOutboxBatch(fixture.db, {
                owner: 'worker-a',
                limit: 25,
                leaseMs: 15_000,
                now: new Date('2026-08-16T00:00:00.000Z'),
            })
        ).resolves.toEqual([{ id: 41n, payload: validPayload, attempts: 2 }]);
        expect(fixture.queryRaw).toHaveBeenCalledTimes(1);
    });

    it('publishes and acknowledges a valid payload', async () => {
        const fixture = createDb([{ id: 1n, payload: validPayload, attempts: 1 }]);
        const publish = vi.fn().mockResolvedValue(undefined);
        const result = await dispatchReadModelOutboxBatch(fixture.db, publish, {
            owner: 'worker-a',
            now: () => new Date('2026-08-16T00:00:00.000Z'),
        });

        expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
        expect(publish).toHaveBeenCalledWith(validPayload, 1n);
        expect(fixture.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 1n, lockOwner: 'worker-a', deliveredAt: null },
                data: expect.objectContaining({ deliveredAt: new Date('2026-08-16T00:00:00.000Z') }),
            })
        );
    });

    it('releases failed and malformed rows with bounded retry state', async () => {
        const fixture = createDb([
            { id: 1n, payload: validPayload, attempts: 3 },
            { id: 2n, payload: { version: 99 }, attempts: 1 },
        ]);
        const publish = vi.fn().mockRejectedValue(new Error('redis unavailable'));
        const result = await dispatchReadModelOutboxBatch(fixture.db, publish, {
            owner: 'worker-a',
            retryBaseMs: 1_000,
            retryMaxMs: 10_000,
            now: () => new Date('2026-08-16T00:00:00.000Z'),
        });

        expect(result).toEqual({ claimed: 2, delivered: 0, failed: 2 });
        expect(publish).toHaveBeenCalledTimes(1);
        expect(fixture.updateMany).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                where: { id: 1n, lockOwner: 'worker-a', deliveredAt: null },
                data: expect.objectContaining({ availableAt: new Date('2026-08-16T00:00:04.000Z') }),
            })
        );
        expect(fixture.updateMany).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                where: { id: 2n, lockOwner: 'worker-a', deliveredAt: null },
                data: expect.objectContaining({ availableAt: new Date('2026-08-16T00:00:01.000Z') }),
            })
        );
    });

    it('prunes only a bounded delivered batch', async () => {
        const fixture = createDb([{ id: 1n }, { id: 2n }]);
        await expect(
            pruneDeliveredReadModelOutbox(fixture.db, {
                deliveredBefore: new Date('2026-08-15T00:00:00.000Z'),
                limit: 100,
            })
        ).resolves.toBe(2);
    });
});
