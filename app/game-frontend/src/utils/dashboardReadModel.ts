import {
    createEmptyRealtimeReadModelInvalidation,
    mergeRealtimeReadModelInvalidations,
    resolveRealtimeReadModelInvalidation,
    type RealtimeReadModelChanges,
    type RealtimeReadModelInvalidation,
    type RealtimeViewerIdentity,
} from '@sammo-ts/common';

export type DashboardReadModelIdentity = RealtimeViewerIdentity;
export type DashboardRefreshPlan = RealtimeReadModelInvalidation;

export const resolveDashboardRefreshPlan = (
    changes: RealtimeReadModelChanges,
    identity: DashboardReadModelIdentity
): DashboardRefreshPlan => resolveRealtimeReadModelInvalidation(changes, identity);

type TimerHandle = ReturnType<typeof setTimeout>;

export interface MergedReadModelRefreshQueue {
    request(invalidation: RealtimeReadModelInvalidation): void;
    cancelPending(): void;
}

export const createMergedReadModelRefreshQueue = (
    refresh: (invalidation: RealtimeReadModelInvalidation) => Promise<void>,
    options: {
        minIntervalMs?: number;
        now?: () => number;
        setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
        clearTimer?: (handle: TimerHandle) => void;
    } = {}
): MergedReadModelRefreshQueue => {
    const minIntervalMs = Math.max(0, options.minIntervalMs ?? 1_000);
    const now = options.now ?? Date.now;
    const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    let pending = createEmptyRealtimeReadModelInvalidation();
    let hasPending = false;
    let running = false;
    let timer: TimerHandle | null = null;
    let lastStartedAt = Number.NEGATIVE_INFINITY;

    const schedule = () => {
        if (!hasPending || running || timer !== null) {
            return;
        }
        const delayMs = Math.max(0, lastStartedAt + minIntervalMs - now());
        timer = setTimer(() => {
            timer = null;
            if (!hasPending || running) {
                return;
            }
            const next = pending;
            pending = createEmptyRealtimeReadModelInvalidation();
            hasPending = false;
            running = true;
            lastStartedAt = now();
            void refresh(next).finally(() => {
                running = false;
                schedule();
            });
        }, delayMs);
    };

    return {
        request: (invalidation) => {
            pending = hasPending ? mergeRealtimeReadModelInvalidations(pending, invalidation) : invalidation;
            hasPending = true;
            schedule();
        },
        cancelPending: () => {
            hasPending = false;
            pending = createEmptyRealtimeReadModelInvalidation();
            if (timer !== null) {
                clearTimer(timer);
                timer = null;
            }
        },
    };
};
