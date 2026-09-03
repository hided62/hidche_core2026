import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../src/context.js';
import { loadClockAdminStatus, loadClockReadiness } from '../src/services/clockReadiness.js';

describe('clock reconciliation readiness', () => {
    it('fails closed when the reconciliation schema is not available', async () => {
        const db = {} as DatabaseClient;
        await expect(loadClockReadiness(db)).resolves.toEqual({
            reconciliationComplete: false,
            gameplayEnabled: false,
            phase: null,
            revision: null,
            deadlineGeneration: null,
            incompleteOutboxCount: null,
        });
    });

    it('blocks readiness for RECONCILING or incomplete outbox state', async () => {
        const db = {
            worldState: {
                findFirst: vi.fn(async () => ({
                    clockPhase: 'RECONCILING',
                    clockRevision: 9n,
                    deadlineGeneration: 4n,
                })),
            },
            clockProjectionOutbox: { count: vi.fn(async () => 1) },
        } as unknown as DatabaseClient;
        await expect(loadClockReadiness(db)).resolves.toMatchObject({
            reconciliationComplete: false,
            gameplayEnabled: false,
            phase: 'RECONCILING',
            revision: 9,
            deadlineGeneration: 4,
            incompleteOutboxCount: 1,
        });
    });

    it('exposes participant checksums and incomplete outbox detail to admins', async () => {
        const db = {
            worldState: {
                findFirst: vi.fn(async () => ({
                    clockPhase: 'RUNNING',
                    clockRevision: 3n,
                    deadlineGeneration: 2n,
                })),
            },
            clockProjectionOutbox: { count: vi.fn(async () => 0) },
            clockSuspension: {
                findFirst: vi.fn(async () => ({
                    id: 'maintenance-1',
                    source: 'MAINTENANCE',
                    policy: 'EXACT',
                    status: 'APPLIED',
                    sourceRevision: 2n,
                    targetRevision: 3n,
                    cutTick: 100n,
                    alignedTick: 130n,
                    participantChecksumBefore: 'before-all',
                    participantChecksumAfter: 'after-all',
                    participants: [
                        {
                            participantKey: 'general-turn',
                            policy: 'SHIFT',
                            beforeChecksum: 'before',
                            afterChecksum: 'after',
                            affectedCount: 2,
                        },
                    ],
                    projectionOutbox: [{ id: 8n, targetRevision: 3n, status: 'APPLIED', attempts: 1, lastError: null }],
                })),
            },
        } as unknown as DatabaseClient;

        await expect(loadClockAdminStatus(db)).resolves.toMatchObject({
            reconciliationComplete: true,
            latestReconciliation: {
                id: 'maintenance-1',
                participantChecksumBefore: 'before-all',
                participantChecksumAfter: 'after-all',
                participants: [{ key: 'general-turn', policy: 'SHIFT', affectedCount: 2 }],
                outbox: [{ id: '8', status: 'APPLIED' }],
            },
        });
    });
});
