import type { ZodType } from 'zod';

export const parseArgsWithSchema = <T>(schema: ZodType<T>, raw: unknown): T | null => {
    const result = schema.safeParse(raw);
    return result.success ? result.data : null;
};
