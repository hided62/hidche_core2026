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
