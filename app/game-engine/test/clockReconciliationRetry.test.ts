import { describe, expect, it, vi } from 'vitest';

import type { GamePrismaClient } from '@sammo-ts/infra';
import {
    reconcileClockSuspension,
    startClockSuspension,
    type ClockReconciliationResult,
    type ClockSuspensionResult,
} from '../src/turn/clockReconciliation.js';

const authority = { kind: 'OFFLINE' as const, profileName: 'retry-test', reason: 'isolated unit test' };

describe('serializable clock operation retries', () => {
    it('retries a PostgreSQL serialization conflict while starting suspension', async () => {
        const result: ClockSuspensionResult = {
            suspensionId: 'retry-start',
            phase: 'SUSPENDED',
            sourceRevision: 7,
            targetRevision: 8,
            cutTick: 123,
            cutWallAt: new Date('2026-09-03T10:00:00.000Z'),
        };
        const transaction = vi
            .fn()
            .mockRejectedValueOnce(Object.assign(new Error('could not serialize access'), { code: 'P2034' }))
            .mockResolvedValueOnce(result);
        const db = { $transaction: transaction } as unknown as GamePrismaClient;

        await expect(
            startClockSuspension({ db, suspensionId: result.suspensionId, source: 'MAINTENANCE', authority })
        ).resolves.toEqual(result);
        expect(transaction).toHaveBeenCalledTimes(2);
    });

    it('retries a raw 40001 conflict while reconciling suspension', async () => {
        const result: ClockReconciliationResult = {
            suspensionId: 'retry-resume',
            phase: 'RECONCILING',
            sourceRevision: 7,
            targetRevision: 8,
            deadlineGeneration: 8,
            gapTicks: 100,
            catchUpTicks: 0,
            shiftTicks: 100,
            alignedTick: 223,
            resumeWallAt: new Date('2026-09-03T10:10:00.000Z'),
        };
        const transaction = vi
            .fn()
            .mockRejectedValueOnce(
                Object.assign(new Error('SQLSTATE 40001'), { code: 'P2010', meta: { code: '40001' } })
            )
            .mockResolvedValueOnce(result);
        const db = { $transaction: transaction } as unknown as GamePrismaClient;

        await expect(reconcileClockSuspension({ db, suspensionId: result.suspensionId, authority })).resolves.toEqual(
            result
        );
        expect(transaction).toHaveBeenCalledTimes(2);
    });

    it('does not retry a non-serialization failure', async () => {
        const transaction = vi.fn().mockRejectedValue(new Error('authority denied'));
        const db = { $transaction: transaction } as unknown as GamePrismaClient;

        await expect(
            startClockSuspension({ db, suspensionId: 'no-retry', source: 'MAINTENANCE', authority })
        ).rejects.toThrow('authority denied');
        expect(transaction).toHaveBeenCalledTimes(1);
    });
});
