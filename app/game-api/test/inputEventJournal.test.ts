import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { GameApiContext } from '../src/context.js';
import { procedure, router } from '../src/trpc.js';

const testRouter = router({
    mutate: procedure
        .input(z.object({ fail: z.boolean().optional().default(false) }))
        .mutation(({ ctx, input }) => {
            (ctx as GameApiContext & { testOrder: string[] }).testOrder.push('handler');
            ctx.changeJournal?.mark('front.general', 7);
            if (input.fail) throw new Error('injected rollback');
            return { ok: true };
        }),
});

const createContext = () => {
    const order: string[] = [];
    const queryRaw = vi.fn(async () => {
        order.push('journal');
        return [{ domain: 'front.general', entityId: 7, revision: 1n, outboxId: 11n }];
    });
    const transaction = {
        $queryRaw: queryRaw,
        inputEvent: {
            update: vi.fn(async () => {
                order.push('succeeded');
                return {};
            }),
        },
    };
    const db = {
        inputEvent: {
            create: vi.fn(async () => {
                order.push('accepted');
                return {};
            }),
            updateMany: vi.fn(async () => ({ count: 0 })),
            update: vi.fn(async () => {
                order.push('failed');
                return {};
            }),
        },
        $transaction: vi.fn(async (callback: (db: typeof transaction) => Promise<unknown>) => {
            order.push('transaction-begin');
            try {
                const result = await callback(transaction);
                order.push('commit');
                return result;
            } catch (error) {
                order.push('rollback');
                throw error;
            }
        }),
    };
    const redisPublish = vi.fn();
    const wake = vi.fn(() => order.push('wake'));
    const context = {
        requestId: 'journal-unit',
        db,
        redis: { publish: redisPublish },
        readModelOutbox: { wake },
        testOrder: order,
    } as unknown as GameApiContext & { testOrder: string[] };
    return { context, order, queryRaw, redisPublish, wake };
};

describe('API input-event change journal boundary', () => {
    it('writes the journal with SUCCEEDED, commits, and only then schedules delivery', async () => {
        const fixture = createContext();

        await expect(testRouter.createCaller(fixture.context).mutate({})).resolves.toEqual({ ok: true });

        expect(fixture.order).toEqual([
            'accepted',
            'transaction-begin',
            'handler',
            'journal',
            'succeeded',
            'commit',
            'wake',
        ]);
        expect(fixture.redisPublish).not.toHaveBeenCalled();
        expect(fixture.wake).toHaveBeenCalledTimes(1);
    });

    it('rolls back a handler mark without writing or scheduling an outbox row', async () => {
        const fixture = createContext();

        await expect(testRouter.createCaller(fixture.context).mutate({ fail: true })).rejects.toThrow(
            'injected rollback'
        );

        expect(fixture.order).toEqual(['accepted', 'transaction-begin', 'handler', 'rollback', 'failed']);
        expect(fixture.queryRaw).not.toHaveBeenCalled();
        expect(fixture.redisPublish).not.toHaveBeenCalled();
        expect(fixture.wake).not.toHaveBeenCalled();
    });
});
