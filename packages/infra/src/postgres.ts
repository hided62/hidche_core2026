import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

export type PostgresLogLevel = 'query' | 'info' | 'warn' | 'error';

export type PostgresLogOption =
    | PostgresLogLevel
    | {
          emit: 'stdout' | 'event';
          level: PostgresLogLevel;
      };

export interface PostgresConfig {
    url: string;
    log?: PostgresLogOption[];
}

export interface PostgresConnector<TClient = unknown> {
    readonly prisma: TClient;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
}

export interface PrismaClientFactoryOptions {
    adapter: PrismaPg;
    log?: PostgresLogOption[];
}

export type PrismaClientFactory<TClient> = (options: PrismaClientFactoryOptions) => TClient;

const resolveSchemaName = (value: string | undefined): string => {
    if (!value) {
        return 'public';
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : 'public';
};

const applySchemaToDatabaseUrl = (url: string, schema: string | undefined): string => {
    if (!schema) {
        return url;
    }
    try {
        const parsed = new URL(url);
        parsed.searchParams.set('schema', resolveSchemaName(schema));
        return parsed.toString();
    } catch {
        return url;
    }
};

const extractSchemaFromDatabaseUrl = (url: string): string | undefined => {
    try {
        const parsed = new URL(url);
        const schema = parsed.searchParams.get('schema');
        return schema && schema.trim() ? schema.trim() : undefined;
    } catch {
        return undefined;
    }
};

const buildDatabaseUrlFromEnv = (env: NodeJS.ProcessEnv, schemaOverride?: string): string => {
    const host = env.POSTGRES_HOST ?? '127.0.0.1';
    const port = env.POSTGRES_PORT ?? '15432';
    const user = env.POSTGRES_USER ?? 'sammo';
    const password = env.POSTGRES_PASSWORD ?? '';
    const dbName = env.POSTGRES_DB ?? 'sammo';
    const schema = resolveSchemaName(schemaOverride ?? env.POSTGRES_SCHEMA ?? env.DATABASE_SCHEMA);
    return `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=${schema}`;
};

export const resolvePostgresConfigFromEnv = (
    options: { env?: NodeJS.ProcessEnv; schema?: string } = {}
): PostgresConfig => {
    const env = options.env ?? process.env;
    const url = env.DATABASE_URL
        ? applySchemaToDatabaseUrl(env.DATABASE_URL, options.schema)
        : buildDatabaseUrlFromEnv(env, options.schema);
    if (!url) {
        throw new Error('DATABASE_URL is required to create a Postgres client.');
    }

    return { url };
};

export const createPostgresConnector = <TClient>(
    config: PostgresConfig,
    createClient: PrismaClientFactory<TClient>
): PostgresConnector<TClient> => {
    const schema =
        extractSchemaFromDatabaseUrl(config.url) ?? process.env.POSTGRES_SCHEMA ?? process.env.DATABASE_SCHEMA;
    const pool = new Pool({
        connectionString: config.url,
        ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
    const adapter = new PrismaPg(pool, schema ? { schema } : undefined);
    const prisma = createClient({
        adapter,
        log: config.log,
    });

    return {
        prisma,
        connect: () => (prisma as { $connect: () => Promise<void> }).$connect(),
        disconnect: async () => {
            await (prisma as { $disconnect: () => Promise<void> }).$disconnect();
            await pool.end();
        },
    };
};
