import type { City, Nation } from '@sammo-ts/logic';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

export const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

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

export const readBoolean = (value: unknown, fallback = false): boolean => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        return value === 'true' || value === '1';
    }
    return fallback;
};

export const readString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

export const readMetaNumber = (meta: Record<string, unknown>, key: string, fallback = 0): number =>
    readNumber(meta[key], fallback);

export const readMetaString = (meta: Record<string, unknown>, key: string, fallback = ''): string =>
    readString(meta[key], fallback);

export const readMetaBoolean = (meta: Record<string, unknown>, key: string, fallback = false): boolean =>
    readBoolean(meta[key], fallback);

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

export const calcCityDevRatio = (city: City): number => {
    const total = city.agriculture + city.commerce + city.security + city.defence + city.wall;
    const max = city.agricultureMax + city.commerceMax + city.securityMax + city.defenceMax + city.wallMax;
    if (max <= 0) {
        return 0;
    }
    return total / max;
};

export const readNationTech = (nation: Nation | null | undefined): number => {
    if (!nation) {
        return 0;
    }
    return readMetaNumber(asRecord(nation.meta), 'tech', 0);
};
