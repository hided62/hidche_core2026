import { PrismaClient, type PrismaClientOptions } from '@prisma/client';

export interface PostgresConfig {
    url: string;
    log?: PrismaClientOptions['log'];
}

export interface PostgresConnector {
    readonly prisma: PrismaClient;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
}

export const resolvePostgresConfigFromEnv = (
    env: NodeJS.ProcessEnv = process.env
): PostgresConfig => {
    const url = env.DATABASE_URL ?? '';
    if (!url) {
        throw new Error('DATABASE_URL is required to create a Postgres client.');
    }

    return { url };
};

export const createPostgresConnector = (
    config: PostgresConfig
): PostgresConnector => {
    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: config.url,
            },
        },
        log: config.log,
    });

    return {
        prisma,
        connect: () => prisma.$connect(),
        disconnect: () => prisma.$disconnect(),
    };
};
