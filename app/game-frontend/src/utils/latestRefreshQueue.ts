export type LatestRefreshQueue = {
    request: () => Promise<void>;
    isRunning: () => boolean;
};

/**
 * Coalesces bursts while guaranteeing one final refresh after an in-flight run.
 * This matches realtime state semantics: intermediate turn notifications can be
 * skipped, but the newest committed server state must never be lost.
 */
export const createLatestRefreshQueue = (refresh: () => Promise<void>): LatestRefreshQueue => {
    let active: Promise<void> | null = null;
    let refreshAgain = false;

    const request = (): Promise<void> => {
        if (active) {
            refreshAgain = true;
            return active;
        }

        const run = async () => {
            do {
                refreshAgain = false;
                await refresh();
            } while (refreshAgain);
        };

        active = run().finally(() => {
            active = null;
        });
        return active;
    };

    return {
        request,
        isRunning: () => active !== null,
    };
};
