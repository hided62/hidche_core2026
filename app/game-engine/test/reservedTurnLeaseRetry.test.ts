import { describe, expect, it, vi } from 'vitest';
import { createReservedTurnLeaseRetry } from '../src/turn/reservedTurnLeaseRetry.js';
import { ReservedTurnLeaseBusyError, ReservedTurnLeaseConflictError } from '../src/turn/reservedTurnStore.js';

describe('reserved turn acquisition retry', () => {
    it('bounds the entire contention episode across different queues and resets after progress', async () => {
        let now = 0;
        const onWait = vi.fn();
        const retry = createReservedTurnLeaseRetry({
            now: () => now,
            sleep: async (ms) => {
                now += ms;
            },
            maxWaitMs: 2_500,
            onWait,
        });
        expect(await retry.wait(new ReservedTurnLeaseBusyError('general:1'))).toBe(true);
        expect(await retry.wait(new ReservedTurnLeaseBusyError('nation:2:12'))).toBe(true);
        expect(await retry.wait(new ReservedTurnLeaseBusyError('general:3'))).toBe(true);
        expect(now).toBe(2_500);
        expect(await retry.wait(new ReservedTurnLeaseBusyError('general:1'))).toBe(false);
        expect(onWait).toHaveBeenCalledTimes(1);
        retry.reset();
        expect(await retry.wait(new ReservedTurnLeaseBusyError('general:1'))).toBe(true);
    });

    it('never retries flush ownership loss, calculation errors, or failed savepoint restoration', async () => {
        const sleep = vi.fn();
        const retry = createReservedTurnLeaseRetry({ sleep });
        for (const error of [
            new ReservedTurnLeaseConflictError('general:1'),
            new Error('calculation failed'),
            new AggregateError([new ReservedTurnLeaseBusyError('general:1')], 'restore failed'),
        ])
            expect(await retry.wait(error)).toBe(false);
        expect(sleep).not.toHaveBeenCalled();
    });
});
