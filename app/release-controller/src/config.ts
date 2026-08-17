import path from 'node:path';

import { sanitizeManagedProcessEnv } from '@sammo-ts/gateway-api';
import { resolvePostgresPoolMax } from '@sammo-ts/infra';

const parsePositiveInt = (value: string | undefined, fallback: number, name: string): number => {
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
    return parsed;
};

const applySchema = (databaseUrl: string, schema: string): string => {
    const parsed = new URL(databaseUrl);
    parsed.searchParams.set('schema', schema);
    return parsed.toString();
};

export interface ReleaseControllerConfig {
    workspaceRoot: string;
    worktreeRoot: string;
    gatewayDatabaseUrl: string;
    gatewayDbSchema: string;
    gatewayApiPort: number;
    gatewayFrontendPort: number;
    gatewayBasePath: string;
    pollIntervalMs: number;
    readinessTimeoutMs: number;
    postgresPoolMax: number;
    baseEnv: Record<string, string>;
}

export const resolveReleaseControllerConfig = (env: NodeJS.ProcessEnv = process.env): ReleaseControllerConfig => {
    const rawGatewayDatabaseUrl = env.GATEWAY_DATABASE_URL ?? env.DATABASE_URL ?? '';
    if (!rawGatewayDatabaseUrl) {
        throw new Error('GATEWAY_DATABASE_URL or DATABASE_URL is required.');
    }
    if (!env.REDIS_URL?.trim()) {
        throw new Error('REDIS_URL is required.');
    }
    const workspaceRoot = path.resolve(env.RELEASE_CONTROLLER_WORKSPACE_ROOT ?? process.cwd());
    const gatewayDbSchema = env.GATEWAY_DB_SCHEMA?.trim() || 'public';
    return {
        workspaceRoot,
        worktreeRoot: path.resolve(
            env.RELEASE_CONTROLLER_WORKTREE_ROOT ?? path.join(workspaceRoot, '.release-worktrees')
        ),
        gatewayDatabaseUrl: applySchema(rawGatewayDatabaseUrl, gatewayDbSchema),
        gatewayDbSchema,
        gatewayApiPort: parsePositiveInt(env.GATEWAY_API_PORT, 15001, 'GATEWAY_API_PORT'),
        gatewayFrontendPort: parsePositiveInt(env.GATEWAY_FRONTEND_PORT, 15000, 'GATEWAY_FRONTEND_PORT'),
        gatewayBasePath: env.GATEWAY_BASE_PATH?.trim() || '/gateway',
        pollIntervalMs: parsePositiveInt(env.RELEASE_CONTROLLER_POLL_MS, 5000, 'RELEASE_CONTROLLER_POLL_MS'),
        readinessTimeoutMs: parsePositiveInt(
            env.RELEASE_CONTROLLER_READINESS_TIMEOUT_MS,
            60000,
            'RELEASE_CONTROLLER_READINESS_TIMEOUT_MS'
        ),
        postgresPoolMax: resolvePostgresPoolMax(env.RELEASE_CONTROLLER_POSTGRES_POOL_MAX ?? env.POSTGRES_POOL_MAX, 2),
        baseEnv: {
            ...sanitizeManagedProcessEnv(env),
            REDIS_URL: env.REDIS_URL.trim(),
        },
    };
};
