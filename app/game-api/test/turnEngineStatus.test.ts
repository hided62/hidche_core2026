import { describe, expect, it, vi } from 'vitest';

import { CachedTurnEngineStatus, loadTurnEngineRunning } from '../src/services/turnEngineStatus.js';

describe('turn engine status projection', () => {
    it('maps Gateway profile capabilities and keeps unavailable status unknown', async () => {
        const activeLease = {
            turnDaemonLease: {
                findUnique: vi.fn(async () => ({ leaseUntil: new Date('2026-08-24T00:01:00.000Z') })),
            },
        };
        const now = new Date('2026-08-24T00:00:00.000Z');
        await expect(loadTurnEngineRunning({ get: async () => 'RUNNING' }, activeLease, 'che:default', now)).resolves.toBe(
            true
        );
        await expect(loadTurnEngineRunning({ get: async () => 'PREOPEN' }, activeLease, 'che:default', now)).resolves.toBe(
            false
        );
        await expect(loadTurnEngineRunning({ get: async () => 'PAUSED' }, activeLease, 'che:default', now)).resolves.toBe(
            false
        );
        await expect(loadTurnEngineRunning({ get: async () => null }, activeLease, 'che:default', now)).resolves.toBeNull();
        await expect(
            loadTurnEngineRunning(
                { get: async () => Promise.reject(new Error('gateway unavailable')) },
                activeLease,
                'che:default',
                now
            )
        ).resolves.toBeNull();
    });

    it('marks a RUNNING profile stopped when its daemon lease is missing or expired', async () => {
        const source = { get: async () => 'RUNNING' as const };
        const now = new Date('2026-08-24T00:00:00.000Z');
        await expect(
            loadTurnEngineRunning(
                source,
                { turnDaemonLease: { findUnique: async () => null } },
                'che:default',
                now
            )
        ).resolves.toBe(false);
        await expect(
            loadTurnEngineRunning(
                source,
                {
                    turnDaemonLease: {
                        findUnique: async () => ({ leaseUntil: new Date('2026-08-23T23:59:59.999Z') }),
                    },
                },
                'che:default',
                now
            )
        ).resolves.toBe(false);
    });

    it('coalesces concurrent heartbeat reads and refreshes after the bounded cache window', async () => {
        let now = 1_000;
        const get = vi.fn(async () => 'RUNNING' as const);
        const findUnique = vi.fn(async () => ({ leaseUntil: new Date('2099-01-01T00:00:00.000Z') }));
        const cache = new CachedTurnEngineStatus(
            { get },
            { turnDaemonLease: { findUnique } },
            'che:default',
            2_000,
            () => now
        );

        await expect(Promise.all([cache.get(), cache.get()])).resolves.toEqual([true, true]);
        expect(get).toHaveBeenCalledTimes(1);
        now += 1_999;
        await expect(cache.get()).resolves.toBe(true);
        expect(get).toHaveBeenCalledTimes(1);
        now += 1;
        await expect(cache.get()).resolves.toBe(true);
        expect(get).toHaveBeenCalledTimes(2);
        expect(findUnique).toHaveBeenCalledTimes(2);
    });
});
