import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

export interface PostgresConfig {
    url: string;
    log?: Prisma.PrismaClientOptions['log'];
}

export interface PostgresConnector {
    readonly prisma: PrismaClient;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
}

const buildDatabaseUrlFromEnv = (
    env: NodeJS.ProcessEnv
): string => {
    const host = env.POSTGRES_HOST ?? '127.0.0.1';
    const port = env.POSTGRES_PORT ?? '15432';
    const user = env.POSTGRES_USER ?? 'sammo';
    const password = env.POSTGRES_PASSWORD ?? '';
    const dbName = env.POSTGRES_DB ?? 'sammo';
    return `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
};

export const resolvePostgresConfigFromEnv = (
    env: NodeJS.ProcessEnv = process.env
): PostgresConfig => {
    const url = env.DATABASE_URL ?? buildDatabaseUrlFromEnv(env);
    if (!url) {
        throw new Error('DATABASE_URL is required to create a Postgres client.');
    }

    return { url };
};

export const createPostgresConnector = (
    config: PostgresConfig
): PostgresConnector => {
    const pool = new Pool({
        connectionString: config.url,
    });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({
        adapter,
        log: config.log,
    });

    return {
        prisma,
        connect: () => prisma.$connect(),
        disconnect: async () => {
            await prisma.$disconnect();
            await pool.end();
        },
    };
};
