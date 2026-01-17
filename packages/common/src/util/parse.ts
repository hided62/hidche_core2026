export const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

export const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

export const asNumber = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const asString = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

export const asNullableNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

export const asNullableString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export const asNullableStringArray = (value: unknown): string[] | null => {
    if (value === null || value === undefined) {
        return null;
    }
    return asStringArray(value);
};

export const parseNumberWithFallback = (value: string | undefined, fallback: number, label?: string): number => {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
        if (label) {
            throw new Error(`${label} must be a number.`);
        }
        return fallback;
    }
    return parsed;
};

export const parseOptionalNumber = (value: string | undefined): number | undefined => {
    if (!value) {
        return undefined;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }
    return parsed;
};

export const parseBooleanWithFallback = (value: string | undefined, fallback: boolean): boolean => {
    if (!value) {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
        return false;
    }
    return fallback;
};

export const parseOptionalBoolean = (value: string | undefined): boolean | undefined => {
    if (!value) {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
        return false;
    }
    return undefined;
};

export const parseJson = <T>(raw: string | null): T | null => {
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
};
