import { describe, expect, it, vi } from 'vitest';
import { TurnDaemonLeaseUnavailableError } from '../src/lifecycle/databaseTurnDaemonLease.js';
import { retryTurnDaemonLeaseStartup } from '../src/turn/leaseStartupRetry.js';

describe('lease startup retry', () => {
    it('survives more than the PM2 startup failure budget and returns only a fresh runtime', async () => {
        const freshRuntime = { owner: 'new-owner' };
        let attempts = 0;
        const create = vi.fn(async () => {
            if (++attempts <= 20) throw new TurnDaemonLeaseUnavailableError('test');
            return freshRuntime;
        });
        const wait = vi.fn(async () => {});
        expect(await retryTurnDaemonLeaseStartup(create, wait)).toBe(freshRuntime);
        expect(create).toHaveBeenCalledTimes(21);
        expect(wait).toHaveBeenCalledTimes(20);
    });
    it('propagates gameplay or startup faults instead of hiding them in a retry loop', async () => {
        const error = new Error('invalid world');
        const create = vi.fn(async () => {
            throw error;
        });
        const wait = vi.fn(async () => {});
        await expect(retryTurnDaemonLeaseStartup(create, wait)).rejects.toBe(error);
        expect(create).toHaveBeenCalledTimes(1);
        expect(wait).not.toHaveBeenCalled();
    });
});
