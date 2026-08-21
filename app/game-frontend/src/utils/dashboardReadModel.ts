import {
    createEmptyRealtimeReadModelInvalidation,
    mergeRealtimeReadModelInvalidations,
    resolveRealtimeReadModelInvalidation,
    type RealtimeReadModelChanges,
    type RealtimeReadModelInvalidation,
    type RealtimeViewerIdentity,
} from '@sammo-ts/common/realtime/types';

export type DashboardReadModelIdentity = RealtimeViewerIdentity;
export type DashboardRefreshPlan = RealtimeReadModelInvalidation;
export type DashboardContextBundleInclude = {
    context: boolean;
    commandTable: boolean;
    boardAccess: boolean;
};

export const resolveDashboardRefreshPlan = (
    changes: RealtimeReadModelChanges,
    identity: DashboardReadModelIdentity
): DashboardRefreshPlan => resolveRealtimeReadModelInvalidation(changes, identity);

export const resolveDashboardContextBundleInclude = (plan: DashboardRefreshPlan): DashboardContextBundleInclude => ({
    context: plan.context,
    commandTable: plan.commands,
    boardAccess: plan.boardAccess,
});

type TimerHandle = ReturnType<typeof setTimeout>;

export interface MergedReadModelRefreshQueue {
    request(invalidation: RealtimeReadModelInvalidation, refreshGrant: string): void;
    cancelPending(): void;
}

export const createMergedReadModelRefreshQueue = (
    refresh: (invalidation: RealtimeReadModelInvalidation, refreshGrant: string) => Promise<void>,
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
    let pendingRefreshGrant = '';
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
            const nextRefreshGrant = pendingRefreshGrant;
            pending = createEmptyRealtimeReadModelInvalidation();
            pendingRefreshGrant = '';
            hasPending = false;
            running = true;
            lastStartedAt = now();
            void refresh(next, nextRefreshGrant).finally(() => {
                running = false;
                schedule();
            });
        }, delayMs);
    };

    return {
        request: (invalidation, refreshGrant) => {
            pending = hasPending ? mergeRealtimeReadModelInvalidations(pending, invalidation) : invalidation;
            pendingRefreshGrant = refreshGrant;
            hasPending = true;
            schedule();
        },
        cancelPending: () => {
            hasPending = false;
            pending = createEmptyRealtimeReadModelInvalidation();
            pendingRefreshGrant = '';
            if (timer !== null) {
                clearTimer(timer);
                timer = null;
            }
        },
    };
};
