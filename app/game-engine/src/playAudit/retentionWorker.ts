import type { AuditRetentionResult } from './retention.js';

/** 진행할 자료가 있을 때만 계속 실행한다. 일반 게임 턴/페이지 요청에 정리를 결합하지 않는다. */
export const startAuditRetentionWorker = (options: {
    prune: () => Promise<AuditRetentionResult>;
    onError: (error: unknown) => void;
}): { stop: () => Promise<void> } => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running: Promise<void> | undefined;
    const schedule = (delay: number) => {
        if (stopped) return;
        timer = setTimeout(() => {
            timer = undefined;
            running = run();
        }, delay);
        timer.unref();
    };
    const run = async () => {
        let delay = 1000;
        try {
            const result = await options.prune();
            if (result.status === 'complete' || result.status === 'identityChanged') stopped = true;
            if (result.status === 'busy') delay = 30_000;
        } catch (error) {
            delay = 30_000;
            options.onError(error);
        } finally {
            schedule(delay);
        }
    };
    schedule(0);
    return {
        stop: async () => {
            stopped = true;
            if (timer) clearTimeout(timer);
            await running;
        },
    };
};
