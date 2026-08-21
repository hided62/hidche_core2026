export type ServerClockProjectionInput = {
    serverTime?: string;
    serverWallTime?: string;
    clockMode?: 'realtime' | 'manual';
    clockRunning?: boolean;
    clockStartsAt?: string | null;
};

export type SampledServerClock = {
    serverTimeMs: number;
    sampledClientTimeMs: number;
    clockMode: 'realtime' | 'manual';
    startDelayMs: number | null;
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

    return {
        serverTimeMs,
        sampledClientTimeMs,
        clockMode: input.clockMode ?? 'realtime',
        startDelayMs,
    };
};

export const projectServerClock = (sample: SampledServerClock, clientTimeMs = Date.now()) => {
    const clientElapsedMs = Math.max(0, clientTimeMs - sample.sampledClientTimeMs);
    const elapsedGameMs =
        sample.clockMode === 'manual' || sample.startDelayMs === null
            ? 0
            : Math.max(0, clientElapsedMs - sample.startDelayMs);

    return {
        clientElapsedMs,
        time: new Date(sample.serverTimeMs + elapsedGameMs),
    };
};

export const millisecondsUntilNextMinute = (time: Date): number => {
    const remainder = ((time.getTime() % 60_000) + 60_000) % 60_000;
    return remainder === 0 ? 60_000 : 60_000 - remainder;
};
