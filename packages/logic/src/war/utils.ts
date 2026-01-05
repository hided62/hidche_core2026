import type { TriggerValue } from '@sammo-ts/logic/domain/entities.js';

const DEX_LEVEL_THRESHOLDS = [
    0, 350, 1375, 3500, 7125, 12650, 20475, 31000, 44625, 61750, 82775, 108100, 138125, 173250, 213875, 260400, 313225,
    372750, 439375, 513500, 595525, 685850, 784875, 893000, 1010625, 1138150, 1275975,
];

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

export const clampMin = (value: number, min: number): number => (value < min ? min : value);

export const clampMax = (value: number, max: number): number => (value > max ? max : value);

export const round = (value: number): number => Math.round(value);

export const getMetaNumber = (meta: Record<string, TriggerValue>, key: string, fallback = 0): number => {
    const value = meta[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

export const getMetaString = (meta: Record<string, TriggerValue>, key: string): string | null => {
    const value = meta[key];
    return typeof value === 'string' ? value : null;
};

export const setMetaNumber = (meta: Record<string, TriggerValue>, key: string, value: number): void => {
    meta[key] = round(value);
};

export const increaseMetaNumber = (meta: Record<string, TriggerValue>, key: string, delta: number): number => {
    const next = getMetaNumber(meta, key) + delta;
    meta[key] = round(next);
    return next;
};

export const getDexLevel = (dex: number): number => {
    if (!Number.isFinite(dex) || dex < 0) {
        return 0;
    }

    let level = 0;
    for (let idx = 0; idx < DEX_LEVEL_THRESHOLDS.length; idx += 1) {
        const threshold = DEX_LEVEL_THRESHOLDS[idx]!;
        if (dex < threshold) {
            break;
        }
        level = idx;
    }
    return level;
};

export const getDexLog = (dex1: number, dex2: number): number => (getDexLevel(dex1) - getDexLevel(dex2)) / 55 + 1;

export const parseConflict = (raw: TriggerValue | undefined): Record<number, number> | null => {
    if (raw === undefined || raw === null) {
        return null;
    }
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw) as Record<string, number>;
            const result: Record<number, number> = {};
            for (const [key, value] of Object.entries(parsed)) {
                const id = Number(key);
                if (!Number.isFinite(id) || typeof value !== 'number') {
                    continue;
                }
                result[id] = value;
            }
            return Object.keys(result).length ? result : null;
        } catch {
            return null;
        }
    }
    return null;
};

export const stringifyConflict = (conflict: Record<number, number> | null): string => {
    if (!conflict) {
        return '{}';
    }
    const sorted = Object.entries(conflict)
        .map(([key, value]) => [Number(key), value] as const)
        .filter(([key, value]) => Number.isFinite(key) && typeof value === 'number')
        .sort(([, lhs], [, rhs]) => rhs - lhs);

    const ordered: Record<string, number> = {};
    for (const [key, value] of sorted) {
        ordered[String(key)] = value;
    }

    return JSON.stringify(ordered);
};

export const sortConflict = (conflict: Record<number, number>): Record<number, number> => {
    const ordered: Record<number, number> = {};
    const entries = Object.entries(conflict)
        .map(([key, value]) => [Number(key), value] as const)
        .filter(([key, value]) => Number.isFinite(key) && typeof value === 'number')
        .sort(([, lhs], [, rhs]) => rhs - lhs);

    for (const [key, value] of entries) {
        ordered[key] = value;
    }

    return ordered;
};

export const simpleSerialize = (...values: Array<string | number>): string => {
    const result: string[] = [];
    for (const value of values) {
        if (typeof value === 'string') {
            result.push(`str(${value.length},${value})`);
            continue;
        }
        if (Number.isInteger(value)) {
            result.push(`int(${value})`);
            continue;
        }
        const floatValue = value.toLocaleString('en-US', {
            maximumFractionDigits: 6,
            useGrouping: false,
        });
        result.push(`float(${floatValue})`);
    }
    return result.join('|');
};
