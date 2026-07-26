import type { ZodType } from 'zod';

const LEGACY_NUMERIC_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export const normalizeLegacyIntegerArg = (value: unknown): unknown => {
    let numericValue = value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '' || !LEGACY_NUMERIC_PATTERN.test(trimmed)) {
            return value;
        }
        numericValue = Number(trimmed);
    }
    if (typeof numericValue !== 'number' || !Number.isFinite(numericValue)) {
        return value;
    }
    return Math.trunc(numericValue);
};

export const parseArgsWithSchema = <T>(schema: ZodType<T>, raw: unknown): T | null => {
    const result = schema.safeParse(raw);
    return result.success ? result.data : null;
};
