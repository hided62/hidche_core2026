export interface GameApiConfig {
    host: string;
    port: number;
    trpcPath: string;
    profile: string;
    scenario: string;
    profileName: string;
    daemonRequestTimeoutMs: number;
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

export const resolveGameApiConfigFromEnv = (
    env: NodeJS.ProcessEnv = process.env
): GameApiConfig => {
    const profile = env.PROFILE ?? env.SERVER_PROFILE ?? 'che';
    const scenario = env.SCENARIO ?? 'default';
    const profileName = `${profile}:${scenario}`;

    return {
        host: env.GAME_API_HOST ?? '0.0.0.0',
        port: parseNumber(env.GAME_API_PORT, 14000, 'GAME_API_PORT'),
        trpcPath: env.TRPC_PATH ?? '/trpc',
        profile,
        scenario,
        profileName,
        daemonRequestTimeoutMs: parseNumber(
            env.DAEMON_REQUEST_TIMEOUT_MS,
            5000,
            'DAEMON_REQUEST_TIMEOUT_MS'
        ),
    };
};
