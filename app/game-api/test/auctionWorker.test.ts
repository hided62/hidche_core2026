import { describe, expect, it, vi } from 'vitest';

import type { GamePrismaClient } from '@sammo-ts/infra';

import { processDueAuctionId } from '../src/auction/worker.js';

const buildRedis = () => ({
    zRangeByScore: vi.fn(async () => []),
    zRangeWithScores: vi.fn(async () => []),
    zAdd: vi.fn(async () => 1),
    zRem: vi.fn(async () => 0),
    zRemRangeByScore: vi.fn(async () => 0),
});

describe('auction worker clock-shift race', () => {
    it('requeues an OPEN auction at its current DB deadline when an old due score loses the race', async () => {
        const redis = buildRedis();
        const closeAt = new Date('2026-07-30T12:15:00.000Z');
        const db = {
            $executeRaw: vi.fn(async () => 0),
            auction: {
                findFirst: vi.fn(async () => ({ closeAt })),
            },
        } as unknown as GamePrismaClient;
        const sendCommand = vi.fn(async () => {});

        await expect(
            processDueAuctionId({
                db,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: '7',
                nowMs: new Date('2026-07-30T12:00:00.000Z').getTime(),
                sendCommand,
            })
        ).resolves.toBe('RESCHEDULED');

        expect(redis.zAdd).toHaveBeenCalledTimes(1);
        expect(redis.zAdd).toHaveBeenCalledWith('timer', [{ score: closeAt.getTime(), value: '7' }]);
        expect(sendCommand).not.toHaveBeenCalled();
    });

    it('records history and finalizes only after the guarded DB transition succeeds', async () => {
        const redis = buildRedis();
        const db = {
            $executeRaw: vi.fn(async () => 1),
            auction: {
                findFirst: vi.fn(),
            },
        } as unknown as GamePrismaClient;
        const sendCommand = vi.fn(async () => {});
        const nowMs = new Date('2026-07-30T12:00:00.000Z').getTime();

        await expect(
            processDueAuctionId({
                db,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: '7',
                nowMs,
                sendCommand,
            })
        ).resolves.toBe('FINALIZING');

        expect(redis.zAdd).toHaveBeenCalledWith('history', [{ score: nowMs, value: '7' }]);
        expect(db.auction.findFirst).not.toHaveBeenCalled();
        expect(sendCommand).toHaveBeenCalledWith({ type: 'auctionFinalize', auctionId: 7 });
    });
});
