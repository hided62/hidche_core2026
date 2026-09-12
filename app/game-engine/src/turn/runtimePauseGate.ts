import type { GameClockPhase } from '@sammo-ts/common';

/** Gateway의 실행 gate와 durable 시계를 명령 claim 전에 맞춘다. */
export const createRuntimePauseGate = (options: {
    assertLease(): void;
    shouldPause(): Promise<boolean>;
    getPhase(): GameClockPhase;
    isExplicitlyPaused(): boolean;
    prepareRecovery(options: { paused: boolean }): Promise<void>;
    synchronize(): Promise<unknown>;
}): (() => Promise<boolean>) => {
    let lastPaused: boolean | null = null;
    return async () => {
        options.assertLease();
        const paused = await options.shouldPause();
        const phase = options.getPhase();
        // 오류 정지는 Gateway 상태만 PAUSED로 바꿀 수 있다. 그대로 두면 가입은
        // 흐르는 접수 시각을 쓰고, 재개 시 정수 턴 이동까지 중복 적용받는다.
        // PREOPEN은 예정된 대기이므로 오픈 시각을 바꾸지 않는다.
        if (paused && options.isExplicitlyPaused() && phase === 'RUNNING') {
            await options.prepareRecovery({ paused: true });
        } else if (!paused && phase === 'SUSPENDED') {
            // 이 runtime이 만든 RECOVERY 정지는 재기동 없이도 재개한다.
            // MAINTENANCE/통일 대기의 재개 권한은 기존 운영 경계에 남는다.
            await options.prepareRecovery({ paused: false });
        }
        if (lastPaused !== paused || phase === 'SUSPENDED' || phase === 'RECONCILING') {
            await options.synchronize();
        }
        lastPaused = paused;
        return paused;
    };
};
