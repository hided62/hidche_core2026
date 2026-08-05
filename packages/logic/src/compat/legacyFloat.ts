// MariaDB FLOAT stores binary32, but its text protocol exposes only six
// significant decimal digits. Ref reads that text into PHP before every
// command/battle update, so both boundaries are part of the game state.
export const toLegacyStoredFloat = (value: number): number => Math.fround(value);

const roundHalfEven = (value: number): number => {
    const lower = Math.floor(value);
    const fraction = value - lower;
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 4;
    if (Math.abs(fraction - 0.5) <= tolerance) {
        return lower % 2 === 0 ? lower : lower + 1;
    }
    return Math.round(value);
};

export const readLegacyStoredFloat = (value: number): number => {
    const stored = Math.fround(value);
    if (!Number.isFinite(stored) || stored === 0) {
        return stored;
    }
    const sign = stored < 0 ? -1 : 1;
    const absolute = Math.abs(stored);
    const exponent = Math.floor(Math.log10(absolute));
    const scale = 10 ** (5 - exponent);
    return sign * (roundHalfEven(absolute * scale) / scale);
};

export const addLegacyStoredFloat = (current: number, delta: number): number =>
    toLegacyStoredFloat(readLegacyStoredFloat(current) + delta);
