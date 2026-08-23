import { describe, expect, it, vi } from 'vitest';

import type { GamePrismaClient } from '@sammo-ts/infra';

import { processDueAuctionId, reconcilePendingAuctionTimers } from '../src/auction/worker.js';
import { resolveAuctionSeedScore } from '../src/auction/scheduler.js';

const buildRedis = () => ({
    zRangeByScore: vi.fn(async () => []),
    zRangeWithScores: vi.fn(async () => []),
    zAdd: vi.fn(async () => 1),
    zRem: vi.fn(async () => 0),
    zRemRangeByScore: vi.fn(async () => 0),
});

const buildDb = (options: {
    updated: number;
    auction?: {
        status: 'OPEN' | 'FINALIZING' | 'FINISHED' | 'CANCELED';
        closeAt: Date;
        closeTick?: bigint | null;
    } | null;
    existingEvents?: Array<{
        requestId: string;
        target: 'ENGINE';
        eventType: string;
        payload: Record<string, unknown>;
        status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
        result?: Record<string, unknown> | null;
    }>;
}) => {
    const transaction = {
        $executeRaw: vi.fn(async () => options.updated),
        auction: {
            findUnique: vi.fn(async () =>
                options.auction ? { ...options.auction, closeTick: options.auction.closeTick ?? null } : null
            ),
        },
        inputEvent: {
            findUnique: vi.fn(
                async ({ where }: { where: { requestId: string } }) =>
                    options.existingEvents?.find((event) => event.requestId === where.requestId) ?? null
            ),
            create: vi.fn(async (_args?: { data: { eventType: string } }) => ({ sequence: 1n })),
        },
    };
    return {
        db: {
            $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
                callback(transaction)
            ),
        } as unknown as GamePrismaClient,
        transaction,
    };
};

describe('auction worker clock-shift race', () => {
    it('seeds OPEN at its deadline but retries FINALIZING at the current logical tick', () => {
        const now = new Date('2026-07-30T12:00:00.000Z');
        const time = {
            now,
            wallNow: now,
            tick: 36_000_000,
            mode: 'manual' as const,
            running: false,
            startsAt: null,
            dateToTick: () => 72_000_000,
        };
        const closeAt = new Date('2099-01-01T00:00:00.000Z');

        expect(
            resolveAuctionSeedScore(time, {
                id: 7,
                status: 'OPEN',
                closeAt,
                closeTick: 72_000_000n,
            })
        ).toBe(72_000_000);
        expect(
            resolveAuctionSeedScore(time, {
                id: 7,
                status: 'FINALIZING',
                closeAt,
                closeTick: 72_000_000n,
            })
        ).toBe(36_000_000);
    });

    it('requeues an auction immediately after the engine commits an OPEN extension', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2099-01-01T00:00:00.000Z');
        const pendingRequestId = 'auction:finalize:8:tick:72000000';
        const db = {
            auction: {
                findMany: vi.fn(async () => [
                    { id: 7, status: 'OPEN', closeAt, closeTick: 72_000_000n },
                    { id: 8, status: 'FINALIZING', closeAt, closeTick: 72_000_000n },
                    { id: 9, status: 'FINISHED', closeAt, closeTick: 72_000_000n },
                ]),
            },
            inputEvent: {
                findMany: vi.fn(async () => [
                    {
                        requestId: pendingRequestId,
                        target: 'ENGINE',
                        eventType: 'auctionFinalize',
                        payload: {
                            type: 'auctionFinalize',
                            requestId: pendingRequestId,
                            auctionId: 8,
                            expectedCloseAt: closeAt.toISOString(),
                            expectedCloseTick: 72_000_000,
                        },
                        status: 'PENDING',
                    },
                ]),
            },
        } as unknown as Pick<GamePrismaClient, 'auction' | 'inputEvent'>;
        const now = new Date('2026-07-30T12:00:00.000Z');

        await expect(
            reconcilePendingAuctionTimers({
                db,
                redis,
                timerKey: 'timer',
                auctionIds: [7, 8, 9],
                gameTime: {
                    now,
                    wallNow: now,
                    tick: 36_000_000,
                    mode: 'manual',
                    running: false,
                    startsAt: null,
                    dateToTick: () => 72_000_000,
                },
            })
        ).resolves.toEqual({ pendingIds: [8], rescheduled: 1 });
        expect(redis.zAdd).toHaveBeenCalledWith('timer', [{ score: 72_000_000, value: '7' }]);
        expect(redis.zRem).toHaveBeenCalledWith('timer', ['8']);
    });

    it('ignores a prior pending generation and schedules the extended OPEN deadline', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2099-01-01T00:30:00.000Z');
        const previousRequestId = 'auction:finalize:7:tick:72000000';
        const db = {
            auction: {
                findMany: vi.fn(async () => [{ id: 7, status: 'OPEN', closeAt, closeTick: 108_000_000n }]),
            },
            inputEvent: {
                findMany: vi.fn(async () => [
                    {
                        requestId: previousRequestId,
                        target: 'ENGINE',
                        eventType: 'auctionFinalize',
                        payload: {
                            type: 'auctionFinalize',
                            requestId: previousRequestId,
                            auctionId: 7,
                            expectedCloseAt: new Date('2099-01-01T00:00:00.000Z').toISOString(),
                            expectedCloseTick: 72_000_000,
                        },
                        status: 'PENDING',
                    },
                ]),
            },
        } as unknown as Pick<GamePrismaClient, 'auction' | 'inputEvent'>;
        const now = new Date('2026-07-30T12:00:00.000Z');

        await expect(
            reconcilePendingAuctionTimers({
                db,
                redis,
                timerKey: 'timer',
                auctionIds: [7],
                gameTime: {
                    now,
                    wallNow: now,
                    tick: 72_000_000,
                    mode: 'manual',
                    running: false,
                    startsAt: null,
                    dateToTick: () => 108_000_000,
                },
            })
        ).resolves.toEqual({ pendingIds: [], rescheduled: 1 });
        expect(redis.zAdd).toHaveBeenCalledWith('timer', [{ score: 108_000_000, value: '7' }]);
        expect(redis.zRem).not.toHaveBeenCalled();
    });

    it('requeues an OPEN auction at its current DB deadline when an old due score loses the race', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2026-07-30T12:15:00.000Z');
        const { db, transaction } = buildDb({ updated: 0, auction: { status: 'OPEN', closeAt } });

        await expect(
            processDueAuctionId({
                db,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: '7',
                nowMs: new Date('2026-07-30T12:00:00.000Z').getTime(),
            })
        ).resolves.toBe('RESCHEDULED');

        expect(redis.zAdd).toHaveBeenCalledTimes(1);
        expect(redis.zAdd).toHaveBeenCalledWith('timer', [{ score: closeAt.getTime(), value: '7' }]);
        expect(transaction.inputEvent.create).not.toHaveBeenCalled();
    });

    it('requeues a tick-backed auction using its logical deadline score', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2099-01-01T00:00:00.000Z');
        const { db } = buildDb({
            updated: 0,
            auction: { status: 'OPEN', closeAt, closeTick: 72_000_000n },
        });

        await expect(
            processDueAuctionId({
                db,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: '7',
                nowMs: new Date('2042-01-01T00:00:00.000Z').getTime(),
                nowTick: 36_000_000,
            })
        ).resolves.toBe('RESCHEDULED');

        expect(redis.zAdd).toHaveBeenCalledWith('timer', [{ score: 72_000_000, value: '7' }]);
    });

    it('leaves OPEN untouched and creates one durable command before recording history', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2026-07-30T11:00:00.000Z');
        const requestId = `auction:finalize:7:${closeAt.getTime()}`;
        const { db, transaction } = buildDb({ updated: 0, auction: { status: 'OPEN', closeAt } });
        const nowMs = new Date('2026-07-30T12:00:00.000Z').getTime();

        await expect(
            processDueAuctionId({
                db,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: '7',
                nowMs,
            })
        ).resolves.toBe('PENDING');

        expect(redis.zAdd).toHaveBeenCalledWith('history', [{ score: nowMs, value: '7' }]);
        expect(transaction.inputEvent.create).toHaveBeenCalledWith({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'auctionFinalize',
                payload: {
                    type: 'auctionFinalize',
                    requestId,
                    auctionId: 7,
                    expectedCloseAt: closeAt.toISOString(),
                },
            },
        });
        expect(transaction.$executeRaw).not.toHaveBeenCalled();
    });

    it('enqueues finalization at the exact close tick without changing auction status', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2099-01-01T00:00:00.000Z');
        const requestId = 'auction:finalize:7:tick:72000000';
        const { db, transaction } = buildDb({
            updated: 0,
            auction: { status: 'OPEN', closeAt, closeTick: 72_000_000n },
        });

        await expect(
            processDueAuctionId({
                db,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: '7',
                nowMs: new Date('2042-01-01T00:00:00.000Z').getTime(),
                nowTick: 72_000_000,
            })
        ).resolves.toBe('PENDING');
        expect(transaction.inputEvent.create).toHaveBeenCalledWith({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'auctionFinalize',
                payload: {
                    type: 'auctionFinalize',
                    requestId,
                    auctionId: 7,
                    expectedCloseAt: closeAt.toISOString(),
                    expectedCloseTick: 72_000_000,
                },
            },
        });
        expect(transaction.$executeRaw).not.toHaveBeenCalled();
    });

    it('keeps an already-enqueued bid ahead of finalization and does not block it out of band', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2026-07-30T11:00:00.000Z');
        const queuedTypes = ['auctionBid'];
        const { db, transaction } = buildDb({ updated: 0, auction: { status: 'OPEN', closeAt } });

        await expect(
            processDueAuctionId({
                db,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: '7',
                nowMs: new Date('2026-07-30T12:00:00.000Z').getTime(),
            })
        ).resolves.toBe('PENDING');

        const created = transaction.inputEvent.create.mock.calls[0]?.[0] as { data: { eventType: string } } | undefined;
        if (created) queuedTypes.push(created.data.eventType);
        expect(queuedTypes).toEqual(['auctionBid', 'auctionFinalize']);
        expect(transaction.$executeRaw).not.toHaveBeenCalled();
    });

    it('reuses the same pending OPEN-generation event after a worker retry or restart', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2026-07-30T11:00:00.000Z');
        const requestId = `auction:finalize:7:${closeAt.getTime()}`;
        const { db, transaction } = buildDb({
            updated: 0,
            auction: { status: 'OPEN', closeAt },
            existingEvents: [
                {
                    requestId,
                    target: 'ENGINE',
                    eventType: 'auctionFinalize',
                    payload: {
                        type: 'auctionFinalize',
                        requestId,
                        auctionId: 7,
                        expectedCloseAt: closeAt.toISOString(),
                    },
                    status: 'PENDING',
                    result: null,
                },
            ],
        });

        await expect(
            processDueAuctionId({
                db,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: '7',
                nowMs: new Date('2026-07-30T12:00:00.000Z').getTime(),
            })
        ).resolves.toBe('PENDING');
        expect(transaction.inputEvent.create).not.toHaveBeenCalled();
        expect(transaction.$executeRaw).not.toHaveBeenCalled();
    });

    it('records operational history time separately from logical settlement time', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2026-07-30T11:00:00.000Z');
        const { db } = buildDb({ updated: 0, auction: { status: 'FINALIZING', closeAt } });
        const logicalNowMs = new Date('0190-01-01T00:00:00.000Z').getTime();
        const operationalNowMs = new Date('2026-07-30T12:00:00.000Z').getTime();

        await processDueAuctionId({
            db,
            redis,
            timerKey: 'timer',
            historyKey: 'history',
            id: '7',
            nowMs: logicalNowMs,
            historyNowMs: operationalNowMs,
        });

        expect(redis.zAdd).toHaveBeenCalledWith('history', [{ score: operationalNowMs, value: '7' }]);
    });

    it('repairs a pre-existing FINALIZING auction without creating a duplicate command', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2026-07-30T11:00:00.000Z');
        const requestId = `auction:finalize:7:${closeAt.getTime()}`;
        const existingEvent = {
            requestId,
            target: 'ENGINE' as const,
            eventType: 'auctionFinalize',
            payload: { type: 'auctionFinalize', requestId, auctionId: 7 },
            status: 'PENDING' as const,
            result: null,
        };
        const { db, transaction } = buildDb({
            updated: 0,
            auction: { status: 'FINALIZING', closeAt },
            existingEvents: [existingEvent],
        });

        await expect(
            processDueAuctionId({
                db,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: '7',
                nowMs: new Date('2026-07-30T12:00:00.000Z').getTime(),
            })
        ).resolves.toBe('PENDING');

        expect(transaction.inputEvent.create).not.toHaveBeenCalled();
        expect(redis.zAdd).toHaveBeenCalledWith('history', [
            { score: new Date('2026-07-30T12:00:00.000Z').getTime(), value: '7' },
        ]);
    });

    it('creates one bounded successor after a terminal event failure', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2026-07-30T11:00:00.000Z');
        const requestId = `auction:finalize:7:${closeAt.getTime()}`;
        const retryRequestId = `${requestId}:retry:1`;
        const { db, transaction } = buildDb({
            updated: 0,
            auction: { status: 'FINALIZING', closeAt },
            existingEvents: [
                {
                    requestId,
                    target: 'ENGINE',
                    eventType: 'auctionFinalize',
                    payload: { type: 'auctionFinalize', requestId, auctionId: 7 },
                    status: 'FAILED',
                    result: null,
                },
            ],
        });

        await expect(
            processDueAuctionId({
                db,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: '7',
                nowMs: new Date('2026-07-30T12:00:00.000Z').getTime(),
            })
        ).resolves.toBe('PENDING');

        expect(transaction.inputEvent.create).toHaveBeenCalledWith({
            data: {
                requestId: retryRequestId,
                target: 'ENGINE',
                eventType: 'auctionFinalize',
                payload: {
                    type: 'auctionFinalize',
                    requestId: retryRequestId,
                    auctionId: 7,
                    expectedCloseAt: closeAt.toISOString(),
                },
            },
        });
    });

    it('uses the close deadline as the generation so a reopened auction gets a new command', async () => {
        const redis = buildRedis();
        const previousCloseAt = new Date('2026-07-30T11:00:00.000Z');
        const closeAt = new Date('2026-07-30T11:30:00.000Z');
        const previousRequestId = `auction:finalize:7:${previousCloseAt.getTime()}`;
        const requestId = `auction:finalize:7:${closeAt.getTime()}`;
        const { db, transaction } = buildDb({
            updated: 0,
            auction: { status: 'OPEN', closeAt },
            existingEvents: [
                {
                    requestId: previousRequestId,
                    target: 'ENGINE',
                    eventType: 'auctionFinalize',
                    payload: { type: 'auctionFinalize', requestId: previousRequestId, auctionId: 7 },
                    status: 'SUCCEEDED',
                    result: { type: 'auctionFinalize', ok: false, auctionId: 7 },
                },
            ],
        });

        await expect(
            processDueAuctionId({
                db,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: '7',
                nowMs: new Date('2026-07-30T12:00:00.000Z').getTime(),
            })
        ).resolves.toBe('PENDING');

        expect(transaction.inputEvent.create).toHaveBeenCalledWith({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'auctionFinalize',
                payload: {
                    type: 'auctionFinalize',
                    requestId,
                    auctionId: 7,
                    expectedCloseAt: closeAt.toISOString(),
                },
            },
        });
    });

    it('does not touch auction status when durable event creation fails', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2026-07-30T11:00:00.000Z');
        const { db, transaction } = buildDb({ updated: 0, auction: { status: 'OPEN', closeAt } });
        transaction.inputEvent.create.mockRejectedValueOnce(new Error('event insert failed'));

        await expect(
            processDueAuctionId({
                db,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: '7',
                nowMs: new Date('2026-07-30T12:00:00.000Z').getTime(),
            })
        ).rejects.toThrow('event insert failed');

        expect(redis.zAdd).not.toHaveBeenCalled();
        expect(transaction.$executeRaw).not.toHaveBeenCalled();
    });
});
