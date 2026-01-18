import { parseNumberWithFallback } from '@sammo-ts/common';

export interface GameApiConfig {
    host: string;
    port: number;
    trpcPath: string;
    eventsPath: string;
    profile: string;
    scenario: string;
    profileName: string;
    daemonRequestTimeoutMs: number;
    battleSimRequestTimeoutMs: number;
    battleSimResultTtlSeconds: number;
    gameTokenSecret: string;
    flushChannel: string;
}

export const resolveGameApiConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): GameApiConfig => {
    const profile = env.PROFILE ?? env.SERVER_PROFILE ?? 'hwe';
    const scenario = env.SCENARIO ?? 'default';
    const profileName = `${profile}:${scenario}`;
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
        gameTokenSecret: secret,
        flushChannel: `${gatewayPrefix}:flush`,
    };
};
