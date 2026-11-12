import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import { ReservedTurnLeaseBusyError } from './reservedTurnStore.js';

/** rollback 완료 뒤에만 대기한다. 다음 loop에서 pause/lease gate와 최신 큐를 다시 읽는다. */
export const createReservedTurnLeaseRetry = (
    options: {
        now?: () => number;
        sleep?: (ms: number) => Promise<void>;
        maxWaitMs?: number;
        onWait?: (queueKey: string) => void;
    } = {}
) => {
    const now = options.now ?? (() => performance.now());
    const sleep = options.sleep ?? ((ms: number) => setTimeout(ms));
    const maxWaitMs = options.maxWaitMs ?? 5 * 60_000 + 1_000;
    let startedAt: number | null = null;
    let lastReportedAt = -Infinity;
    return {
        reset(): void {
            startedAt = null;
            lastReportedAt = -Infinity;
        },
        async wait(error: unknown): Promise<boolean> {
            if (!(error instanceof ReservedTurnLeaseBusyError)) return false;
            const current = now();
            startedAt ??= current;
            const remaining = maxWaitMs - (current - startedAt);
            if (remaining <= 0) return false;
            if (current - lastReportedAt >= 30_000) {
                options.onWait?.(error.queueKey);
                lastReportedAt = current;
            }
            await sleep(Math.min(1_000, remaining));
            return true;
        },
    };
};
