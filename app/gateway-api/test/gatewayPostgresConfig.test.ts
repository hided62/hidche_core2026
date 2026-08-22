import { describe, expect, it } from 'vitest';

import { resolveGatewayPostgresConfigFromEnv } from '../src/gatewayPostgresConfig.js';

describe('resolveGatewayPostgresConfigFromEnv', () => {
    it('uses the encoded Gateway URL instead of rebuilding one from raw PostgreSQL credentials', () => {
        const config = resolveGatewayPostgresConfigFromEnv(
            {
                GATEWAY_DATABASE_URL: 'postgresql://sammo:encoded%23password@postgres:5432/sammo?schema=legacy',
                POSTGRES_USER: 'sammo',
                POSTGRES_PASSWORD: 'raw#password',
                POSTGRES_HOST: 'postgres',
                POSTGRES_PORT: '5432',
                POSTGRES_DB: 'sammo',
                POSTGRES_POOL_MAX: '4',
            },
            'public'
        );

        const parsed = new URL(config.url);
        expect(parsed.password).toBe('encoded%23password');
        expect(parsed.searchParams.get('schema')).toBe('public');
        expect(config.maxConnections).toBe(4);
    });

    it('keeps DATABASE_URL as the fallback for existing launchers', () => {
        const config = resolveGatewayPostgresConfigFromEnv({
            DATABASE_URL: 'postgresql://sammo:password@postgres:5432/sammo?schema=public',
        });

        expect(config.url).toBe('postgresql://sammo:password@postgres:5432/sammo?schema=public');
    });
});
