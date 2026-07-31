export interface ResourceCleanupStep {
    name: string;
    run: () => Promise<void>;
}

/**
 * 종료 단계 하나가 실패해도 나머지 연결을 모두 닫고, 다음 호출에서는 실패한
 * 단계만 재시도합니다. 동시에 들어온 종료 요청은 같은 실행을 공유합니다.
 */
export const createBestEffortResourceCloser = (steps: readonly ResourceCleanupStep[]): (() => Promise<void>) => {
    const completed = new Set<string>();
    let closing: Promise<void> | null = null;

    return async (): Promise<void> => {
        if (completed.size === steps.length) return;
        if (closing) return closing;

        closing = (async () => {
            const errors: Error[] = [];
            for (const step of steps) {
                if (completed.has(step.name)) continue;
                try {
                    await step.run();
                    completed.add(step.name);
                } catch (error) {
                    errors.push(new Error(`Failed to close resource: ${step.name}`, { cause: error }));
                }
            }
            if (errors.length > 0) {
                throw new AggregateError(errors, 'One or more resources failed to close.');
            }
        })();

        try {
            await closing;
        } finally {
            closing = null;
        }
    };
};
