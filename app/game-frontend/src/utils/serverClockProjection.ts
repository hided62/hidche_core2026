export type ServerClockProjectionInput = {
    serverTime?: string;
    serverWallTime?: string;
    clockMode?: 'realtime' | 'manual';
    clockRunning?: boolean;
    clockStartsAt?: string | null;
    clockRecovery?: { startsAt: string; endsAt: string } | null;
};

export type SampledServerClock = {
    serverTimeMs: number;
    sampledClientTimeMs: number;
    serverWallTimeMs?: number;
    clockMode: 'realtime' | 'manual';
    startDelayMs: number | null;
    recoveryStartDelayMs?: number;
    recoveryEndDelayMs?: number;
};

const parseInstant = (value?: string | null): number | null => {
    if (!value) return null;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
};

export const sampleServerClock = (
    input: ServerClockProjectionInput,
    sampledClientTimeMs = Date.now()
): SampledServerClock | null => {
    const serverTimeMs = parseInstant(input.serverTime);
    if (serverTimeMs === null) return null;

    let startDelayMs: number | null;
    if (input.clockMode === 'manual') {
        startDelayMs = null;
    } else if (input.clockRunning !== false) {
        startDelayMs = 0;
    } else {
        const serverWallTimeMs = parseInstant(input.serverWallTime);
        const clockStartsAtMs = parseInstant(input.clockStartsAt);
        startDelayMs =
            serverWallTimeMs !== null && clockStartsAtMs !== null
                ? Math.max(0, clockStartsAtMs - serverWallTimeMs)
                : null;
    }

    const wallSample = parseInstant(input.serverWallTime);
    const recoveryStart = parseInstant(input.clockRecovery?.startsAt);
    const recoveryEnd = parseInstant(input.clockRecovery?.endsAt);
    return {
        serverTimeMs,
        sampledClientTimeMs,
        ...(wallSample !== null ? { serverWallTimeMs: wallSample } : {}),
        clockMode: input.clockMode ?? 'realtime',
        startDelayMs,
        ...(wallSample !== null && recoveryStart !== null && recoveryEnd !== null && recoveryEnd > recoveryStart
            ? {
                  recoveryStartDelayMs: recoveryStart - wallSample,
                  recoveryEndDelayMs: recoveryEnd - wallSample,
              }
            : {}),
    };
};

export const projectServerClock = (sample: SampledServerClock, clientTimeMs = Date.now()) => {
    const clientElapsedMs = Math.max(0, clientTimeMs - sample.sampledClientTimeMs);
    const elapsedGameMs =
        sample.clockMode === 'manual' || sample.startDelayMs === null
            ? 0
            : Math.max(0, clientElapsedMs - sample.startDelayMs);

    const accelerationMs =
        sample.startDelayMs === null || sample.clockMode === 'manual'
            ? 0
            : Math.max(
                  0,
                  Math.min(clientElapsedMs, sample.recoveryEndDelayMs ?? 0) -
                      Math.max(0, sample.recoveryStartDelayMs ?? 0)
              );
    const rate =
        sample.startDelayMs !== null &&
        sample.clockMode !== 'manual' &&
        clientElapsedMs >= (sample.recoveryStartDelayMs ?? Infinity) &&
        clientElapsedMs < (sample.recoveryEndDelayMs ?? -Infinity)
            ? 2
            : 1;
    return {
        clientElapsedMs,
        rate,
        time: new Date(sample.serverTimeMs + elapsedGameMs + accelerationMs),
    };
};

export const millisecondsUntilNextMinute = (time: Date): number => {
    const remainder = ((time.getTime() % 60_000) + 60_000) % 60_000;
    return remainder === 0 ? 60_000 : 60_000 - remainder;
};

// 복구 종료 좌표를 기준으로 역산한다. 종료 이후의 턴에는 2배속을 적용하지 않는다.
export const projectRecoveryTime = (sample: SampledServerClock | null, gameTime: Date): Date => {
    if (
        !sample ||
        sample.clockMode === 'manual' ||
        sample.startDelayMs === null ||
        sample.serverWallTimeMs === undefined ||
        sample.recoveryStartDelayMs === undefined ||
        sample.recoveryEndDelayMs === undefined
    )
        return gameTime;
    const endDelay = sample.recoveryEndDelayMs;
    const endGame = projectServerClock(sample, sample.sampledClientTimeMs + Math.max(0, endDelay)).time.getTime();
    const endWall = sample.serverWallTimeMs + endDelay;
    const span = endDelay - sample.recoveryStartDelayMs;
    const startGame = endGame - 2 * span;
    const target = gameTime.getTime();
    // 이전 기록은 이 복구 창으로 실제 발생 시각을 알 수 없으므로 그대로 둔다.
    if (target < startGame) return gameTime;
    return new Date(Math.ceil(target <= endGame ? endWall - (endGame - target) / 2 : endWall + target - endGame));
};
