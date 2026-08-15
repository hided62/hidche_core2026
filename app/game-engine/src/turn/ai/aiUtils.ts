import type { City } from '@sammo-ts/logic';
import { asRecord } from '@sammo-ts/common';

export { asRecord };

export const readNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

export const readMetaNumber = (meta: Record<string, unknown>, key: string, fallback = 0): number =>
    readNumber(meta[key], fallback);

export const readRequiredMetaNumber = (meta: Record<string, unknown>, key: string, context?: string): number => {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    const suffix = context ? ` (${context})` : '';
    throw new Error(`meta.${key} is required${suffix}.`);
};

export const valueFit = (value: number, min?: number | null, max?: number | null): number => {
    let next = value;
    if (min !== null && min !== undefined && next < min) {
        next = min;
    }
    if (max !== null && max !== undefined && next > max) {
        next = max;
    }
    return next;
};

export const roundTo = (value: number, digits = 0): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    const factor = Math.pow(10, Math.abs(digits));
    if (digits >= 0) {
        return Math.round(value * factor) / factor;
    }
    return Math.round(value / factor) * factor;
};

export const joinYearMonth = (year: number, month: number): number => year * 12 + month - 1;

export const parseYearMonth = (value: number): [number, number] => {
    const year = Math.floor(value / 12);
    const month = (value % 12) + 1;
    return [year, month];
};

export const withCanonicalArgumentAliases = (args: Record<string, unknown>): Record<string, unknown> => {
    const normalized = { ...args };
    for (const [legacyKey, canonicalKey] of [
        ['destCityID', 'destCityId'],
        ['destNationID', 'destNationId'],
        ['destGeneralID', 'destGeneralId'],
        ['destTroopID', 'destTroopId'],
    ] as const) {
        if (normalized[canonicalKey] === undefined && normalized[legacyKey] !== undefined) {
            normalized[canonicalKey] = normalized[legacyKey];
        }
    }
    return normalized;
};

export const calcCityDevRatio = (city: City): number => {
    const total = city.agriculture + city.commerce + city.security + city.defence + city.wall;
    const max = city.agricultureMax + city.commerceMax + city.securityMax + city.defenceMax + city.wallMax;
    if (max <= 0) {
        return 0;
    }
    return total / max;
};
