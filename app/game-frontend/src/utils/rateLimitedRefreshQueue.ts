export type RateLimitedRefreshQueue = {
    request: () => void;
    beginCooldown: () => void;
    cancelPending: () => void;
    isRunning: () => boolean;
};

type TimerHandle = ReturnType<typeof setTimeout>;

export type RateLimitedRefreshQueueOptions = {
    minIntervalMs: number;
    now?: () => number;
    setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
    clearTimer?: (timer: TimerHandle) => void;
};

/**
 * Keeps a sustained notification stream from turning into a sustained request
 * stream. One trailing refresh is retained, while starts are bounded by the
 * configured interval.
 */
export const createRateLimitedRefreshQueue = (
    refresh: () => Promise<void>,
    options: RateLimitedRefreshQueueOptions
): RateLimitedRefreshQueue => {
    const minIntervalMs = Math.max(0, options.minIntervalMs);
    const now = options.now ?? Date.now;
    const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));

    let active = false;
    let pending = false;
    let timer: TimerHandle | null = null;
    let lastStartedAt = Number.NEGATIVE_INFINITY;

    const schedule = () => {
        if (!pending || active || timer) return;
        const delayMs = Math.max(0, lastStartedAt + minIntervalMs - now());
        timer = setTimer(() => {
            timer = null;
            if (!pending) return;
            pending = false;
            active = true;
            lastStartedAt = now();
            void refresh().finally(() => {
                active = false;
                schedule();
            });
        }, delayMs);
    };

    return {
        request: () => {
            pending = true;
            schedule();
        },
        beginCooldown: () => {
            lastStartedAt = now();
        },
        cancelPending: () => {
            pending = false;
            if (timer) {
                clearTimer(timer);
                timer = null;
            }
        },
        isRunning: () => active || timer !== null,
    };
};
