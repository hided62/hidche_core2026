import { createClient, type RedisClientOptions } from 'redis';

export interface RedisConfig {
    url: string;
    database?: number;
    options?: Omit<RedisClientOptions, 'url' | 'database'>;
}

export interface RedisConnector {
    readonly client: ReturnType<typeof createClient>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
}

export const resolveRedisConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): RedisConfig => {
    const url = env.REDIS_URL ?? '';
    if (!url) {
        throw new Error('REDIS_URL is required to create a Redis client.');
    }

    const database = env.REDIS_DB !== undefined ? Number(env.REDIS_DB) : undefined;
    if (database !== undefined && Number.isNaN(database)) {
        throw new Error('REDIS_DB must be a number when provided.');
    }

    return { url, database };
};

export const createRedisConnector = (config: RedisConfig): RedisConnector => {
    const client = createClient({
        url: config.url,
        database: config.database,
        ...config.options,
    });

    return {
        client,
        connect: async () => {
            await client.connect();
        },
        disconnect: async () => {
            await client.quit();
        },
    };
};
