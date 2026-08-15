export const ACCESS_REFRESH_LIMIT_COEFFICIENT = 10;

export type AccessLimitLevel = 0 | 1 | 2;

export const calculateAccessRefreshLimit = (tickSeconds: number): number => {
    if (!Number.isFinite(tickSeconds) || tickSeconds <= 0) {
        throw new RangeError('tickSeconds must be a positive finite number.');
    }
    const turnMinutes = tickSeconds / 60;
    return Math.round(Math.pow(turnMinutes, 0.6) * 3) * ACCESS_REFRESH_LIMIT_COEFFICIENT;
};

export const resolveAccessRefreshLimit = (tickSeconds: number, storedLimit: unknown): number => {
    if (typeof storedLimit === 'number' && Number.isSafeInteger(storedLimit) && storedLimit > 0) {
        return storedLimit;
    }
    return calculateAccessRefreshLimit(tickSeconds);
};

export const resolveAccessLimitLevel = (refreshScore: number, refreshLimit: number): AccessLimitLevel => {
    if (refreshScore > refreshLimit) {
        return 2;
    }
    if (refreshScore > refreshLimit * 0.9) {
        return 1;
    }
    return 0;
};
