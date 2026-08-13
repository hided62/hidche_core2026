import { describe, expect, it, vi } from 'vitest';

import type { GamePrismaClient } from '@sammo-ts/infra';

import { processDueAuctionId } from '../src/auction/worker.js';
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
            findUnique: vi.fn(async () => options.auction ?? null),
        },
        inputEvent: {
            findUnique: vi.fn(
                async ({ where }: { where: { requestId: string } }) =>
                    options.existingEvents?.find((event) => event.requestId === where.requestId) ?? null
            ),
            create: vi.fn(async () => ({ sequence: 1n })),
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
            tick: 36_000_000,
            mode: 'manual' as const,
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

    it('commits the FINALIZING transition and durable command in one transaction before recording history', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2026-07-30T11:00:00.000Z');
        const requestId = `auction:finalize:7:${closeAt.getTime()}`;
        const { db, transaction } = buildDb({ updated: 1, auction: { status: 'FINALIZING', closeAt } });
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
        ).resolves.toBe('FINALIZING');

        expect(redis.zAdd).toHaveBeenCalledWith('history', [{ score: nowMs, value: '7' }]);
        expect(transaction.inputEvent.create).toHaveBeenCalledWith({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'auctionFinalize',
                payload: { type: 'auctionFinalize', requestId, auctionId: 7 },
            },
        });
    });

    it('records operational history time separately from logical settlement time', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2026-07-30T11:00:00.000Z');
        const { db } = buildDb({ updated: 1, auction: { status: 'FINALIZING', closeAt } });
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
        ).resolves.toBe('FINALIZING');

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
        ).resolves.toBe('FINALIZING');

        expect(transaction.inputEvent.create).toHaveBeenCalledWith({
            data: {
                requestId: retryRequestId,
                target: 'ENGINE',
                eventType: 'auctionFinalize',
                payload: { type: 'auctionFinalize', requestId: retryRequestId, auctionId: 7 },
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
            updated: 1,
            auction: { status: 'FINALIZING', closeAt },
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
        ).resolves.toBe('FINALIZING');

        expect(transaction.inputEvent.create).toHaveBeenCalledWith({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'auctionFinalize',
                payload: { type: 'auctionFinalize', requestId, auctionId: 7 },
            },
        });
    });

    it('rolls the auction transition back when durable event creation fails', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2026-07-30T11:00:00.000Z');
        const { db, transaction } = buildDb({ updated: 1, auction: { status: 'FINALIZING', closeAt } });
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
    });
});
