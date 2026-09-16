import { afterEach, describe, expect, it, vi } from 'vitest';
import { startAuditRetentionWorker } from '../src/playAudit/retentionWorker.js';
import type { AuditRetentionResult } from '../src/playAudit/retention.js';

afterEach(() => vi.useRealTimers());
describe('audit retention scheduling', () => {
    it('backs off errors and lock contention, then stops polling when no previous season remains', async () => {
        vi.useFakeTimers();
        const prune = vi
            .fn<() => Promise<AuditRetentionResult>>()
            .mockRejectedValueOnce(new Error('database failure'))
            .mockResolvedValueOnce({ status: 'busy', deleted: 0 })
            .mockResolvedValueOnce({ status: 'progress', deleted: 200 })
            .mockResolvedValue({ status: 'complete', deleted: 0 });
        const onError = vi.fn();
        const worker = startAuditRetentionWorker({ prune, onError });
        await vi.advanceTimersByTimeAsync(0);
        expect(onError).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(29_999);
        expect(prune).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(30_001);
        expect(prune).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(1000);
        expect(prune).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(600_000);
        expect(prune).toHaveBeenCalledTimes(4);
        await worker.stop();
    });
    it('never overlaps batches and waits for the in-flight transaction when closing', async () => {
        vi.useFakeTimers();
        let finish!: (result: AuditRetentionResult) => void;
        const prune = vi.fn(
            () =>
                new Promise<AuditRetentionResult>((resolve) => {
                    finish = resolve;
                })
        );
        const worker = startAuditRetentionWorker({ prune, onError: vi.fn() });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(prune).toHaveBeenCalledOnce();
        let closed = false;
        const stop = worker.stop().then(() => {
            closed = true;
        });
        await Promise.resolve();
        expect(closed).toBe(false);
        finish({ status: 'progress', deleted: 200 });
        await stop;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(prune).toHaveBeenCalledOnce();
    });
    it('does not use an old runtime identity after reset', async () => {
        vi.useFakeTimers();
        const prune = vi.fn(async (): Promise<AuditRetentionResult> => ({ status: 'identityChanged', deleted: 0 }));
        const worker = startAuditRetentionWorker({ prune, onError: vi.fn() });
        await vi.advanceTimersByTimeAsync(600_000);
        expect(prune).toHaveBeenCalledOnce();
        await worker.stop();
    });
});
