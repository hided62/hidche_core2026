import { describe, expect, it, vi } from 'vitest';
import { SessionRevocationCommandBudget, parseSessionRevocationWatermark } from '../src/auth/sessionRevocation.js';

describe('session revocation command ownership', () => {
    it('holds capacity after caller timeout until the actual command settles, then recovers', async () => {
        vi.useFakeTimers();
        const budget = new SessionRevocationCommandBudget(1);
        let finish!: () => void;
        const actual = new Promise<void>((resolve) => {
            finish = resolve;
        });
        try {
            const timed = expect(budget.run(() => actual)).rejects.toThrow('unavailable');
            await vi.advanceTimersByTimeAsync(2000);
            await timed;
            const extra = vi.fn(async () => 'extra');
            await expect(budget.run(extra)).rejects.toThrow('unavailable');
            expect(extra).not.toHaveBeenCalled();
            finish();
            await actual;
            await expect(budget.run(extra)).resolves.toBe('extra');
        } finally {
            finish();
            vi.useRealTimers();
        }
    });
    it('releases capacity after synchronous startup or asynchronous backend failure', async () => {
        const budget = new SessionRevocationCommandBudget(1);
        await expect(
            budget.run(() => {
                throw new Error('synthetic');
            })
        ).rejects.toThrow('unavailable');
        await expect(
            budget.run(async () => {
                throw new Error('synthetic');
            })
        ).rejects.toThrow('unavailable');
        await expect(budget.run(async () => 'ok')).resolves.toBe('ok');
    });
    it('validates numeric persisted timestamps while distinguishing absent state', () => {
        expect(parseSessionRevocationWatermark(null)).toBeNull();
        expect(parseSessionRevocationWatermark('0')?.getTime()).toBe(0);
        expect(() => parseSessionRevocationWatermark('NaN')).toThrow();
        expect(() => parseSessionRevocationWatermark('8640000000000001')).toThrow();
    });
});
