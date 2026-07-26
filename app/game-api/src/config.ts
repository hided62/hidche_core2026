import { parseNumberWithFallback } from '@sammo-ts/common';

export interface GameApiConfig {
    host: string;
    port: number;
    trpcPath: string;
    eventsPath: string;
    uploadPath: string;
    uploadDir: string;
    uploadPublicUrl: string | null;
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
    flushChannel: string;
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
        profile,
        scenario,
        profileName,
        daemonRequestTimeoutMs: parseNumberWithFallback(env.DAEMON_REQUEST_TIMEOUT_MS, 5000, 'DAEMON_REQUEST_TIMEOUT_MS'),
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
        auctionTimerPollMs: parseNumberWithFallback(
            env.AUCTION_TIMER_POLL_MS,
            1000,
            'AUCTION_TIMER_POLL_MS'
        ),
        auctionTimerResyncMs: parseNumberWithFallback(
            env.AUCTION_TIMER_RESYNC_MS,
            300000,
            'AUCTION_TIMER_RESYNC_MS'
        ),
        auctionTimerRetentionSeconds: parseNumberWithFallback(
            env.AUCTION_TIMER_RETENTION_SECONDS,
            21600,
            'AUCTION_TIMER_RETENTION_SECONDS'
        ),
        tournamentPollMs: parseNumberWithFallback(
            env.TOURNAMENT_POLL_MS,
            1000,
            'TOURNAMENT_POLL_MS'
        ),
        gameTokenSecret: secret,
        flushChannel: `${gatewayPrefix}:flush`,
    };
};
