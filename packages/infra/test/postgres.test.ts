import { describe, expect, it } from 'vitest';

import { DEFAULT_POSTGRES_POOL_MAX, resolvePostgresConfigFromEnv, resolvePostgresPoolMax } from '../src/postgres.js';

describe('PostgreSQL pool configuration', () => {
    it('uses the driver-compatible default when no explicit budget exists', () => {
        expect(resolvePostgresPoolMax(undefined)).toBe(DEFAULT_POSTGRES_POOL_MAX);
        expect(
            resolvePostgresConfigFromEnv({
                env: { DATABASE_URL: 'postgresql://integration.invalid/sammo?schema=che' },
            })
        ).toMatchObject({ maxConnections: DEFAULT_POSTGRES_POOL_MAX });
    });

    it('accepts an explicit environment budget', () => {
        expect(
            resolvePostgresConfigFromEnv({
                env: {
                    DATABASE_URL: 'postgresql://integration.invalid/sammo?schema=che',
                    POSTGRES_POOL_MAX: '4',
                },
            })
        ).toMatchObject({ maxConnections: 4 });
    });

    it.each(['0', '-1', '1.5', '1001', 'not-a-number'])('rejects invalid pool budget %s', (value) => {
        expect(() => resolvePostgresPoolMax(value)).toThrow(/pool max/u);
    });
});
