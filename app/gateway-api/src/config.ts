import path from 'node:path';

export interface GatewayApiConfig {
    host: string;
    port: number;
    trpcPath: string;
    dbSchema: string;
    redisKeyPrefix: string;
    flushChannel: string;
    sessionTtlSeconds: number;
    gameSessionTtlSeconds: number;
    gameTokenSecret: string;
    oauthSessionTtlSeconds: number;
    kakaoRestKey: string;
    kakaoAdminKey?: string;
    kakaoRedirectUri: string;
    publicBaseUrl: string;
    orchestratorEnabled: boolean;
    orchestratorReconcileIntervalMs: number;
    orchestratorScheduleIntervalMs: number;
    orchestratorBuildIntervalMs: number;
    orchestratorAdminIntervalMs: number;
    workspaceRootHint: string;
    worktreeRoot: string;
}

export interface GatewayOrchestratorConfig {
    dbSchema: string;
    redisKeyPrefix: string;
    gameTokenSecret: string;
    orchestratorReconcileIntervalMs: number;
    orchestratorScheduleIntervalMs: number;
    orchestratorBuildIntervalMs: number;
    orchestratorAdminIntervalMs: number;
    workspaceRootHint: string;
    worktreeRoot: string;
}

const parseNumber = (value: string | undefined, fallback: number, label: string): number => {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
        throw new Error(`${label} must be a number.`);
    }
    return parsed;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
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

const resolveSchemaName = (value: string | undefined): string => {
    if (!value) {
        return 'public';
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : 'public';
};

export const resolveGatewayApiConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): GatewayApiConfig => {
    const secret = env.GAME_TOKEN_SECRET ?? env.GATEWAY_TOKEN_SECRET ?? '';
    if (!secret) {
        throw new Error('GAME_TOKEN_SECRET is required for gateway token encryption.');
    }
    const kakaoRestKey = env.KAKAO_REST_KEY ?? '';
    const kakaoRedirectUri = env.KAKAO_REDIRECT_URI ?? '';
    if (!kakaoRestKey || !kakaoRedirectUri) {
        throw new Error('KAKAO_REST_KEY and KAKAO_REDIRECT_URI are required.');
    }
    const publicBaseUrl = env.GATEWAY_PUBLIC_URL ?? kakaoRedirectUri;
    const redisKeyPrefix = env.GATEWAY_REDIS_PREFIX ?? 'sammo:gateway';
    return {
        host: env.GATEWAY_API_HOST ?? '0.0.0.0',
        port: parseNumber(env.GATEWAY_API_PORT, 13000, 'GATEWAY_API_PORT'),
        trpcPath: env.TRPC_PATH ?? '/trpc',
        dbSchema: resolveSchemaName(env.GATEWAY_DB_SCHEMA),
        redisKeyPrefix,
        flushChannel: `${redisKeyPrefix}:flush`,
        sessionTtlSeconds: parseNumber(env.SESSION_TTL_SECONDS, 60 * 60 * 24 * 7, 'SESSION_TTL_SECONDS'),
        gameSessionTtlSeconds: parseNumber(env.GAME_SESSION_TTL_SECONDS, 60 * 60 * 6, 'GAME_SESSION_TTL_SECONDS'),
        gameTokenSecret: secret,
        oauthSessionTtlSeconds: parseNumber(env.OAUTH_SESSION_TTL_SECONDS, 10 * 60, 'OAUTH_SESSION_TTL_SECONDS'),
        kakaoRestKey,
        kakaoAdminKey: env.KAKAO_ADMIN_KEY,
        kakaoRedirectUri,
        publicBaseUrl,
        orchestratorEnabled: parseBoolean(env.GATEWAY_ORCHESTRATOR_ENABLED, false),
        orchestratorReconcileIntervalMs: parseNumber(
            env.GATEWAY_ORCHESTRATOR_RECONCILE_MS,
            15000,
            'GATEWAY_ORCHESTRATOR_RECONCILE_MS'
        ),
        orchestratorScheduleIntervalMs: parseNumber(
            env.GATEWAY_ORCHESTRATOR_SCHEDULE_MS,
            5000,
            'GATEWAY_ORCHESTRATOR_SCHEDULE_MS'
        ),
        orchestratorBuildIntervalMs: parseNumber(
            env.GATEWAY_ORCHESTRATOR_BUILD_MS,
            10000,
            'GATEWAY_ORCHESTRATOR_BUILD_MS'
        ),
        orchestratorAdminIntervalMs: parseNumber(
            env.GATEWAY_ORCHESTRATOR_ADMIN_MS,
            5000,
            'GATEWAY_ORCHESTRATOR_ADMIN_MS'
        ),
        workspaceRootHint: env.GATEWAY_WORKSPACE_ROOT ?? process.cwd(),
        worktreeRoot:
            env.GATEWAY_WORKTREE_ROOT ?? path.resolve(env.GATEWAY_WORKSPACE_ROOT ?? process.cwd(), '.worktrees'),
    };
};

export const resolveGatewayOrchestratorConfigFromEnv = (
    env: NodeJS.ProcessEnv = process.env
): GatewayOrchestratorConfig => {
    const secret = env.GAME_TOKEN_SECRET ?? env.GATEWAY_TOKEN_SECRET ?? '';
    if (!secret) {
        throw new Error('GAME_TOKEN_SECRET is required for game server processes.');
    }
    const redisKeyPrefix = env.GATEWAY_REDIS_PREFIX ?? 'sammo:gateway';
    return {
        dbSchema: resolveSchemaName(env.GATEWAY_DB_SCHEMA),
        redisKeyPrefix,
        gameTokenSecret: secret,
        orchestratorReconcileIntervalMs: parseNumber(
            env.GATEWAY_ORCHESTRATOR_RECONCILE_MS,
            15000,
            'GATEWAY_ORCHESTRATOR_RECONCILE_MS'
        ),
        orchestratorScheduleIntervalMs: parseNumber(
            env.GATEWAY_ORCHESTRATOR_SCHEDULE_MS,
            5000,
            'GATEWAY_ORCHESTRATOR_SCHEDULE_MS'
        ),
        orchestratorBuildIntervalMs: parseNumber(
            env.GATEWAY_ORCHESTRATOR_BUILD_MS,
            10000,
            'GATEWAY_ORCHESTRATOR_BUILD_MS'
        ),
        orchestratorAdminIntervalMs: parseNumber(
            env.GATEWAY_ORCHESTRATOR_ADMIN_MS,
            5000,
            'GATEWAY_ORCHESTRATOR_ADMIN_MS'
        ),
        workspaceRootHint: env.GATEWAY_WORKSPACE_ROOT ?? process.cwd(),
        worktreeRoot:
            env.GATEWAY_WORKTREE_ROOT ?? path.resolve(env.GATEWAY_WORKSPACE_ROOT ?? process.cwd(), '.worktrees'),
    };
};
