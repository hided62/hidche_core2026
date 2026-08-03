/**
 * MariaDB stores city.trust as FLOAT (binary32), while the PHP driver exposes
 * the value rounded to six significant decimal digits on the next read.
 * Keep those boundaries separate so later SQL expressions use binary32 state.
 */
export const storeLegacyCityTrust = (value: number): number => Math.fround(value);

export const readLegacyCityTrust = (value: number): number => Number(Math.fround(value).toPrecision(6));
