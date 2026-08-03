// MariaDB FLOAT stores binary32, but its text protocol exposes only six
// significant decimal digits. Ref reads that text into PHP before every
// command/battle update, so both boundaries are part of the game state.
export const toLegacyStoredFloat = (value: number): number => Math.fround(value);

export const readLegacyStoredFloat = (value: number): number =>
    Number(Math.fround(value).toPrecision(6));

export const addLegacyStoredFloat = (current: number, delta: number): number =>
    toLegacyStoredFloat(readLegacyStoredFloat(current) + delta);
