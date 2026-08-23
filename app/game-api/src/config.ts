import { parseNumberWithFallback } from '@sammo-ts/common';

const parseReconcileInterval = (value: string | undefined): number => {
    const parsed = parseNumberWithFallback(value, 30_000, 'ACCOUNT_ICON_RESET_RECONCILE_INTERVAL_MS');
    if (!Number.isSafeInteger(parsed) || parsed < 1_000) {
        throw new Error('ACCOUNT_ICON_RESET_RECONCILE_INTERVAL_MS must be an integer of at least 1000.');
    }
    return parsed;
};

export interface GameApiConfig {
    host: string;
    port: number;
    trpcPath: string;
    eventsPath: string;
    uploadPath: string;
    uploadDir: string;
    uploadPublicUrl: string | null;
    imageUploadBaseUrl: string;
    imageUploadSecretFile: string;
    contentImagePublicUrl: string;
    profile: string;
    scenario: string;
    profileName: string;
    daemonRequestTimeoutMs: number;
    battleSimRequestTimeoutMs: number;
    battleSimResultTtlSeconds: number;
    auctionTimerPollMs: number;
    auctionTimerResyncMs: number;
    auctionTimerRetentionSeconds: number;
    tournamentPollMs: number;
    gameTokenSecret: string;
    gatewayInternalApiUrl: string;
    accountIconResetReconcileIntervalMs: number;
    flushChannel: string;
    webPushOutboxPollMs: number;
}

export const resolveGameApiConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): GameApiConfig => {
    const profile = env.PROFILE ?? env.SERVER_PROFILE ?? 'hwe';
    const scenario = env.SCENARIO ?? 'default';
    const profileName = env.GAME_PROFILE_NAME ?? `${profile}:${scenario}`;
    const secret = env.GAME_TOKEN_SECRET ?? env.GATEWAY_TOKEN_SECRET ?? '';
    if (!secret) {
        throw new Error('GAME_TOKEN_SECRET is required for game token verification.');
    }
    const gatewayPrefix = env.GATEWAY_REDIS_PREFIX ?? 'sammo:gateway';

    return {
        host: env.GAME_API_HOST ?? '0.0.0.0',
        port: parseNumberWithFallback(env.GAME_API_PORT, 14000, 'GAME_API_PORT'),
        trpcPath: env.GAME_TRPC_PATH ?? env.TRPC_PATH ?? '/trpc',
        eventsPath: env.GAME_API_EVENTS_PATH ?? '/events',
        uploadPath: env.GAME_UPLOAD_PATH ?? '/uploads',
        uploadDir: env.GAME_UPLOAD_DIR ?? 'uploads',
        uploadPublicUrl: env.GAME_UPLOAD_PUBLIC_URL ?? null,
        imageUploadBaseUrl: env.GAME_IMAGE_UPLOAD_URL ?? 'https://sam-image.hided.net',
        imageUploadSecretFile: env.GAME_IMAGE_UPLOAD_SECRET_FILE ?? '/run/secrets/image_upload_core2026_secret',
        contentImagePublicUrl: env.GAME_CONTENT_IMAGE_PUBLIC_URL ?? 'https://sam-image.hided.net/uploads/core2026',
        profile,
        scenario,
        profileName,
        daemonRequestTimeoutMs: parseNumberWithFallback(
            env.DAEMON_REQUEST_TIMEOUT_MS,
            5000,
            'DAEMON_REQUEST_TIMEOUT_MS'
        ),
        battleSimRequestTimeoutMs: parseNumberWithFallback(
            env.BATTLE_SIM_REQUEST_TIMEOUT_MS,
            8000,
            'BATTLE_SIM_REQUEST_TIMEOUT_MS'
        ),
        battleSimResultTtlSeconds: parseNumberWithFallback(
            env.BATTLE_SIM_RESULT_TTL_SECONDS,
            60,
            'BATTLE_SIM_RESULT_TTL_SECONDS'
        ),
        auctionTimerPollMs: parseNumberWithFallback(env.AUCTION_TIMER_POLL_MS, 1000, 'AUCTION_TIMER_POLL_MS'),
        auctionTimerResyncMs: parseNumberWithFallback(env.AUCTION_TIMER_RESYNC_MS, 300000, 'AUCTION_TIMER_RESYNC_MS'),
        auctionTimerRetentionSeconds: parseNumberWithFallback(
            env.AUCTION_TIMER_RETENTION_SECONDS,
            21600,
            'AUCTION_TIMER_RETENTION_SECONDS'
        ),
        tournamentPollMs: parseNumberWithFallback(env.TOURNAMENT_POLL_MS, 1000, 'TOURNAMENT_POLL_MS'),
        gameTokenSecret: secret,
        gatewayInternalApiUrl: env.GATEWAY_INTERNAL_API_URL ?? 'http://127.0.0.1:13000',
        accountIconResetReconcileIntervalMs: parseReconcileInterval(env.ACCOUNT_ICON_RESET_RECONCILE_INTERVAL_MS),
        flushChannel: `${gatewayPrefix}:flush`,
        webPushOutboxPollMs: parseNumberWithFallback(env.WEB_PUSH_OUTBOX_POLL_MS, 1_000, 'WEB_PUSH_OUTBOX_POLL_MS'),
    };
};
