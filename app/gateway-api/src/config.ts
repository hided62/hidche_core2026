import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseBooleanWithFallback, parseNumberWithFallback } from '@sammo-ts/common';
import { resolveFrontendServeMode, type FrontendServeMode } from './orchestrator/frontendArtifactManager.js';

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
    gatewayInternalApiUrl: string;
    oauthSessionTtlSeconds: number;
    kakaoRestKey: string;
    kakaoAdminKey?: string;
    kakaoRedirectUri: string;
    publicBaseUrl: string;
    userIconDir: string;
    userIconPublicUrl: string;
    imageUploadBaseUrl: string;
    imageUploadSecretFile: string;
    sharedIconPublicUrl: string;
    adminLocalAccountEnabled: boolean;
    localRegistrationEnabled: boolean;
    localAccountGraceDays: number;
    passwordEncryptionPrivateKeyFile?: string;
    legacyPasswordGlobalSalt?: string;
    orchestratorEnabled: boolean;
    orchestratorReconcileIntervalMs: number;
    orchestratorScheduleIntervalMs: number;
    orchestratorBuildIntervalMs: number;
    orchestratorAdminIntervalMs: number;
    workspaceRootHint: string;
    worktreeRoot: string;
    navigationConfigFile: string | null;
    defaultNavigationConfigFile: string;
    frontendServeMode: FrontendServeMode;
    frontendArtifactRoot: string;
    frontendReadinessOrigin: string;
    releaseBuilderUrl?: string;
    webPushEnabled: boolean;
    webPushVapidSubject?: string;
    webPushVapidPublicKey?: string;
    webPushVapidPrivateKey?: string;
    webPushPollIntervalMs: number;
}

export interface GatewayOrchestratorConfig {
    dbSchema: string;
    redisKeyPrefix: string;
    gameTokenSecret: string;
    gatewayInternalApiUrl: string;
    orchestratorReconcileIntervalMs: number;
    orchestratorScheduleIntervalMs: number;
    orchestratorBuildIntervalMs: number;
    orchestratorAdminIntervalMs: number;
    workspaceRootHint: string;
    worktreeRoot: string;
    frontendServeMode?: FrontendServeMode;
    frontendArtifactRoot?: string;
    frontendReadinessOrigin?: string;
    releaseBuilderUrl?: string;
}

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
    const port = parseNumberWithFallback(env.GATEWAY_API_PORT, 13000, 'GATEWAY_API_PORT');
    const workspaceRootHint = env.GATEWAY_WORKSPACE_ROOT ?? process.cwd();
    const webPushEnabled = parseBooleanWithFallback(env.WEB_PUSH_ENABLED, false);
    const webPushVapidSubject = env.WEB_PUSH_VAPID_SUBJECT?.trim() || undefined;
    const webPushVapidPublicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() || undefined;
    let webPushVapidPrivateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() || undefined;
    const webPushVapidPrivateKeyFile = env.WEB_PUSH_VAPID_PRIVATE_KEY_FILE?.trim();
    if (webPushEnabled && !webPushVapidPrivateKey && webPushVapidPrivateKeyFile) {
        try {
            webPushVapidPrivateKey = readFileSync(webPushVapidPrivateKeyFile, 'utf8').trim() || undefined;
        } catch (error) {
            throw new Error('WEB_PUSH_VAPID_PRIVATE_KEY_FILE could not be read.', { cause: error });
        }
    }
    if (webPushEnabled && (!webPushVapidSubject || !webPushVapidPublicKey || !webPushVapidPrivateKey)) {
        throw new Error(
            'WEB_PUSH_ENABLED requires WEB_PUSH_VAPID_SUBJECT, WEB_PUSH_VAPID_PUBLIC_KEY, and a VAPID private key.'
        );
    }
    return {
        host: env.GATEWAY_API_HOST ?? '0.0.0.0',
        port,
        trpcPath: env.GATEWAY_TRPC_PATH ?? env.TRPC_PATH ?? '/trpc',
        dbSchema: resolveSchemaName(env.GATEWAY_DB_SCHEMA),
        redisKeyPrefix,
        flushChannel: `${redisKeyPrefix}:flush`,
        sessionTtlSeconds: parseNumberWithFallback(env.SESSION_TTL_SECONDS, 60 * 60 * 24 * 7, 'SESSION_TTL_SECONDS'),
        gameSessionTtlSeconds: parseNumberWithFallback(
            env.GAME_SESSION_TTL_SECONDS,
            60 * 60 * 6,
            'GAME_SESSION_TTL_SECONDS'
        ),
        gameTokenSecret: secret,
        gatewayInternalApiUrl: env.GATEWAY_INTERNAL_API_URL ?? `http://127.0.0.1:${port}`,
        oauthSessionTtlSeconds: parseNumberWithFallback(
            env.OAUTH_SESSION_TTL_SECONDS,
            10 * 60,
            'OAUTH_SESSION_TTL_SECONDS'
        ),
        kakaoRestKey,
        kakaoAdminKey: env.KAKAO_ADMIN_KEY,
        kakaoRedirectUri,
        publicBaseUrl,
        userIconDir: env.GATEWAY_USER_ICON_DIR ?? 'uploads/user-icons',
        userIconPublicUrl: env.GATEWAY_USER_ICON_PUBLIC_URL ?? 'https://sam-image.hided.net/icons',
        imageUploadBaseUrl: env.GATEWAY_IMAGE_UPLOAD_URL ?? 'https://sam-image.hided.net',
        imageUploadSecretFile: env.GATEWAY_IMAGE_UPLOAD_SECRET_FILE ?? '/run/secrets/image_upload_core2026_secret',
        sharedIconPublicUrl: env.GATEWAY_SHARED_ICON_PUBLIC_URL ?? 'https://sam-image.hided.net/icons',
        adminLocalAccountEnabled: parseBooleanWithFallback(env.GATEWAY_ADMIN_LOCAL_ACCOUNT_ENABLED, false),
        localRegistrationEnabled: parseBooleanWithFallback(env.GATEWAY_LOCAL_REGISTRATION_ENABLED, true),
        localAccountGraceDays: parseNumberWithFallback(
            env.GATEWAY_LOCAL_ACCOUNT_GRACE_DAYS,
            7,
            'GATEWAY_LOCAL_ACCOUNT_GRACE_DAYS'
        ),
        passwordEncryptionPrivateKeyFile: env.GATEWAY_PASSWORD_ENCRYPTION_PRIVATE_KEY_FILE,
        legacyPasswordGlobalSalt: env.GATEWAY_LEGACY_PASSWORD_GLOBAL_SALT,
        orchestratorEnabled: parseBooleanWithFallback(env.GATEWAY_ORCHESTRATOR_ENABLED, false),
        orchestratorReconcileIntervalMs: parseNumberWithFallback(
            env.GATEWAY_ORCHESTRATOR_RECONCILE_MS,
            15000,
            'GATEWAY_ORCHESTRATOR_RECONCILE_MS'
        ),
        orchestratorScheduleIntervalMs: parseNumberWithFallback(
            env.GATEWAY_ORCHESTRATOR_SCHEDULE_MS,
            5000,
            'GATEWAY_ORCHESTRATOR_SCHEDULE_MS'
        ),
        orchestratorBuildIntervalMs: parseNumberWithFallback(
            env.GATEWAY_ORCHESTRATOR_BUILD_MS,
            10000,
            'GATEWAY_ORCHESTRATOR_BUILD_MS'
        ),
        orchestratorAdminIntervalMs: parseNumberWithFallback(
            env.GATEWAY_ORCHESTRATOR_ADMIN_MS,
            5000,
            'GATEWAY_ORCHESTRATOR_ADMIN_MS'
        ),
        workspaceRootHint,
        worktreeRoot: env.GATEWAY_WORKTREE_ROOT ?? path.resolve(workspaceRootHint, '.worktrees'),
        navigationConfigFile: env.CORE_NAVIGATION_CONFIG_FILE?.trim() || '/srv/data/navigation.json',
        defaultNavigationConfigFile: path.resolve(workspaceRootHint, 'resources/navigation.json'),
        frontendServeMode: resolveFrontendServeMode(env.FRONTEND_SERVE_MODE),
        frontendArtifactRoot: path.resolve(env.FRONTEND_ARTIFACT_ROOT ?? '/srv/frontend-artifacts'),
        frontendReadinessOrigin: env.FRONTEND_READINESS_ORIGIN?.trim() || 'http://caddy',
        releaseBuilderUrl: env.RELEASE_BUILDER_URL?.trim() || undefined,
        webPushEnabled,
        webPushVapidSubject,
        webPushVapidPublicKey,
        webPushVapidPrivateKey,
        webPushPollIntervalMs: parseNumberWithFallback(
            env.WEB_PUSH_POLL_INTERVAL_MS,
            1_000,
            'WEB_PUSH_POLL_INTERVAL_MS'
        ),
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
    const gatewayPort = parseNumberWithFallback(env.GATEWAY_API_PORT, 13000, 'GATEWAY_API_PORT');
    return {
        dbSchema: resolveSchemaName(env.GATEWAY_DB_SCHEMA),
        redisKeyPrefix,
        gameTokenSecret: secret,
        gatewayInternalApiUrl: env.GATEWAY_INTERNAL_API_URL ?? `http://127.0.0.1:${gatewayPort}`,
        orchestratorReconcileIntervalMs: parseNumberWithFallback(
            env.GATEWAY_ORCHESTRATOR_RECONCILE_MS,
            15000,
            'GATEWAY_ORCHESTRATOR_RECONCILE_MS'
        ),
        orchestratorScheduleIntervalMs: parseNumberWithFallback(
            env.GATEWAY_ORCHESTRATOR_SCHEDULE_MS,
            5000,
            'GATEWAY_ORCHESTRATOR_SCHEDULE_MS'
        ),
        orchestratorBuildIntervalMs: parseNumberWithFallback(
            env.GATEWAY_ORCHESTRATOR_BUILD_MS,
            10000,
            'GATEWAY_ORCHESTRATOR_BUILD_MS'
        ),
        orchestratorAdminIntervalMs: parseNumberWithFallback(
            env.GATEWAY_ORCHESTRATOR_ADMIN_MS,
            5000,
            'GATEWAY_ORCHESTRATOR_ADMIN_MS'
        ),
        workspaceRootHint: env.GATEWAY_WORKSPACE_ROOT ?? process.cwd(),
        worktreeRoot:
            env.GATEWAY_WORKTREE_ROOT ?? path.resolve(env.GATEWAY_WORKSPACE_ROOT ?? process.cwd(), '.worktrees'),
        frontendServeMode: resolveFrontendServeMode(env.FRONTEND_SERVE_MODE),
        frontendArtifactRoot: path.resolve(env.FRONTEND_ARTIFACT_ROOT ?? '/srv/frontend-artifacts'),
        frontendReadinessOrigin: env.FRONTEND_READINESS_ORIGIN?.trim() || 'http://caddy',
        releaseBuilderUrl: env.RELEASE_BUILDER_URL?.trim() || undefined,
    };
};
