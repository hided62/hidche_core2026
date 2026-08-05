/**
 * MariaDB stores city.trust as FLOAT (binary32), while the PHP driver exposes
 * the value rounded to six significant decimal digits on the next read.
 * Keep those boundaries separate so later SQL expressions use binary32 state.
 */
import { readLegacyStoredFloat, toLegacyStoredFloat } from '@sammo-ts/logic/compat/legacyFloat.js';

export const storeLegacyCityTrust = (value: number): number => toLegacyStoredFloat(value);

export const readLegacyCityTrust = (value: number): number => readLegacyStoredFloat(value);
