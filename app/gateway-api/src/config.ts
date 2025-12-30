export interface GatewayApiConfig {
    host: string;
    port: number;
    trpcPath: string;
    redisKeyPrefix: string;
    flushChannel: string;
    sessionTtlSeconds: number;
    gameSessionTtlSeconds: number;
    gameTokenSecret: string;
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

export const resolveGatewayApiConfigFromEnv = (
    env: NodeJS.ProcessEnv = process.env
): GatewayApiConfig => {
    const secret = env.GAME_TOKEN_SECRET ?? env.GATEWAY_TOKEN_SECRET ?? '';
    if (!secret) {
        throw new Error('GAME_TOKEN_SECRET is required for gateway token encryption.');
    }
    const redisKeyPrefix = env.GATEWAY_REDIS_PREFIX ?? 'sammo:gateway';
    return {
        host: env.GATEWAY_API_HOST ?? '0.0.0.0',
        port: parseNumber(env.GATEWAY_API_PORT, 13000, 'GATEWAY_API_PORT'),
        trpcPath: env.TRPC_PATH ?? '/trpc',
        redisKeyPrefix,
        flushChannel: `${redisKeyPrefix}:flush`,
        sessionTtlSeconds: parseNumber(env.SESSION_TTL_SECONDS, 60 * 60 * 24 * 7, 'SESSION_TTL_SECONDS'),
        gameSessionTtlSeconds: parseNumber(
            env.GAME_SESSION_TTL_SECONDS,
            60 * 60 * 6,
            'GAME_SESSION_TTL_SECONDS'
        ),
        gameTokenSecret: secret,
    };
};
