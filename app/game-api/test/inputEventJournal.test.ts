import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { GameApiContext } from '../src/context.js';
import { createApiInputPayloadIdentity } from '../src/inputEventBoundary.js';
import { procedure, router } from '../src/trpc.js';

const testRouter = router({
    mutate: procedure.input(z.object({ fail: z.boolean().optional().default(false) })).mutation(({ ctx, input }) => {
        (ctx as GameApiContext & { testOrder: string[] }).testOrder.push('handler');
        ctx.changeJournal?.mark('front.general', 7);
        if (input.fail) throw new Error('injected rollback');
        return { ok: true };
    }),
});

const createContext = (payload: unknown = {}) => {
    const order: string[] = [];
    const queryRaw = vi.fn(async (query: { sql?: string }) => {
        if (query.sql?.includes('FROM input_event')) {
            order.push('locked');
            return [
                {
                    target: 'API',
                    eventType: 'mutate',
                    payload: createApiInputPayloadIdentity(payload),
                    actorUserId: null,
                    status: 'PENDING',
                    result: null,
                    attempts: 0,
                    acceptedGameTick: 100n,
                    acceptedClockRevision: 3n,
                    acceptedDeadlineGeneration: 2n,
                },
            ];
        }
        order.push('journal');
        return [{ domain: 'front.general', entityId: 7, revision: 1n, outboxId: 11n }];
    });
    const transaction = {
        $queryRaw: queryRaw,
        $executeRaw: vi.fn(async (query: { sql?: string }) => {
            order.push(query.sql?.includes('pg_advisory_xact_lock') ? 'clock-fence' : 'accepted');
            return 1;
        }),
        $executeRawUnsafe: vi.fn(async (statement: string) => {
            if (statement.startsWith('SAVEPOINT ')) order.push('savepoint');
            else if (statement.startsWith('ROLLBACK TO ')) order.push('savepoint-rollback');
            else if (statement.startsWith('RELEASE ')) order.push('savepoint-release');
            return 0;
        }),
        inputEvent: {
            update: vi.fn(async (args: { data: { status: string } }) => {
                if (args.data.status === 'PROCESSING') order.push('processing');
                else if (args.data.status === 'SUCCEEDED') order.push('succeeded');
                else if (args.data.status === 'FAILED') order.push('failed');
                return {};
            }),
        },
    };
    const db = {
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
            'transaction-begin',
            'clock-fence',
            'accepted',
            'locked',
            'processing',
            'savepoint',
            'handler',
            'journal',
            'succeeded',
            'savepoint-release',
            'commit',
            'wake',
        ]);
        expect(fixture.redisPublish).not.toHaveBeenCalled();
        expect(fixture.wake).toHaveBeenCalledTimes(1);
    });

    it('rolls back a handler mark without writing or scheduling an outbox row', async () => {
        const fixture = createContext({ fail: true });

        await expect(testRouter.createCaller(fixture.context).mutate({ fail: true })).rejects.toThrow(
            'injected rollback'
        );

        expect(fixture.order).toEqual([
            'transaction-begin',
            'clock-fence',
            'accepted',
            'locked',
            'processing',
            'savepoint',
            'handler',
            'savepoint-rollback',
            'savepoint-release',
            'failed',
            'commit',
        ]);
        expect(fixture.queryRaw).toHaveBeenCalledTimes(1);
        expect(fixture.redisPublish).not.toHaveBeenCalled();
        expect(fixture.wake).not.toHaveBeenCalled();
    });
});
