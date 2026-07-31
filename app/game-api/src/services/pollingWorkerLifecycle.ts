export interface PollingWorkerControl {
    readonly signal: AbortSignal;
    dispose(): void;
}

/**
 * SIGINT/SIGTERM 또는 test AbortSignal을 하나의 idempotent stop signal로
 * 합칩니다. Signal은 새 poll만 막고 현재 처리 중인 작업은 caller가 끝낸 뒤
 * finally에서 resource를 닫게 합니다.
 */
export const createPollingWorkerControl = (externalSignal?: AbortSignal): PollingWorkerControl => {
    const controller = new AbortController();
    const stop = () => controller.abort();

    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    externalSignal?.addEventListener('abort', stop, { once: true });
    if (externalSignal?.aborted) {
        stop();
    }

    let disposed = false;
    return {
        signal: controller.signal,
        dispose: () => {
            if (disposed) return;
            disposed = true;
            process.off('SIGINT', stop);
            process.off('SIGTERM', stop);
            externalSignal?.removeEventListener('abort', stop);
        },
    };
};

export const waitForWorkerPoll = async (signal: AbortSignal, delayMs: number): Promise<void> => {
    if (signal.aborted || delayMs <= 0) return;
    await new Promise<void>((resolve) => {
        const timeout = setTimeout(finish, delayMs);
        function finish() {
            clearTimeout(timeout);
            signal.removeEventListener('abort', finish);
            resolve();
        }
        signal.addEventListener('abort', finish, { once: true });
    });
};
