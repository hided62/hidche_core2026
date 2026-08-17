import { PrismaPg } from '@prisma/adapter-pg';
import pg, { type Pool as PgPool } from 'pg';

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
    maxConnections?: number;
}

export interface PostgresPoolStats {
    max: number;
    total: number;
    active: number;
    idle: number;
    waiting: number;
}

export interface PostgresConnector<TClient = unknown> {
    readonly prisma: TClient;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getPoolStats(): PostgresPoolStats;
}

export interface PrismaClientFactoryOptions {
    adapter: PrismaPg;
    log?: PostgresLogOption[];
}

export type PrismaClientFactory<TClient> = (options: PrismaClientFactoryOptions) => TClient;

export const DEFAULT_POSTGRES_POOL_MAX = 10;
const MAX_POSTGRES_POOL_MAX = 1_000;

export const resolvePostgresPoolMax = (
    value: string | number | undefined,
    fallback = DEFAULT_POSTGRES_POOL_MAX
): number => {
    const candidate = value === undefined || value === '' ? fallback : Number(value);
    if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > MAX_POSTGRES_POOL_MAX) {
        throw new RangeError(`PostgreSQL pool max must be a safe integer from 1 to ${MAX_POSTGRES_POOL_MAX}.`);
    }
    return candidate;
};

interface SharedPoolEntry {
    pool: PgPool;
    references: number;
    maxConnections: number;
}

const sharedPools = new Map<string, SharedPoolEntry>();

const buildSharedPoolKey = (url: string, schema: string | undefined, maxConnections: number): string =>
    JSON.stringify([url, schema ?? '', maxConnections]);

const acquireSharedPool = (
    url: string,
    schema: string | undefined,
    maxConnections: number
): { entry: SharedPoolEntry; release: () => Promise<void> } => {
    const key = buildSharedPoolKey(url, schema, maxConnections);
    let entry = sharedPools.get(key);
    if (!entry) {
        const pool = new pg.Pool({
            connectionString: url,
            max: maxConnections,
            ...(schema ? { options: `-c search_path=${schema}` } : {}),
        });
        entry = { pool, references: 0, maxConnections };
        sharedPools.set(key, entry);
    }
    entry.references += 1;

    let released = false;
    return {
        entry,
        release: async () => {
            if (released) return;
            released = true;
            entry.references -= 1;
            if (entry.references === 0 && sharedPools.get(key) === entry) {
                sharedPools.delete(key);
                await entry.pool.end();
            }
        },
    };
};

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

    return {
        url,
        maxConnections: resolvePostgresPoolMax(env.POSTGRES_POOL_MAX),
    };
};

export const createPostgresConnector = <TClient>(
    config: PostgresConfig,
    createClient: PrismaClientFactory<TClient>
): PostgresConnector<TClient> => {
    const schema =
        extractSchemaFromDatabaseUrl(config.url) ?? process.env.POSTGRES_SCHEMA ?? process.env.DATABASE_SCHEMA;
    const maxConnections = resolvePostgresPoolMax(config.maxConnections ?? process.env.POSTGRES_POOL_MAX);
    const sharedPool = acquireSharedPool(config.url, schema, maxConnections);
    const adapter = new PrismaPg(sharedPool.entry.pool, schema ? { schema } : undefined);
    const prisma = createClient({
        adapter,
        log: config.log,
    });

    let disconnected = false;
    return {
        prisma,
        connect: () => {
            if (disconnected) {
                throw new Error('Postgres connector cannot reconnect after disconnect.');
            }
            return (prisma as { $connect: () => Promise<void> }).$connect();
        },
        disconnect: async () => {
            if (disconnected) return;
            disconnected = true;
            let disconnectError: unknown;
            try {
                await (prisma as { $disconnect: () => Promise<void> }).$disconnect();
            } catch (error) {
                disconnectError = error;
            }
            try {
                await sharedPool.release();
            } catch (error) {
                disconnectError ??= error;
            }
            if (disconnectError) throw disconnectError;
        },
        getPoolStats: () => {
            const { pool } = sharedPool.entry;
            const total = pool.totalCount;
            const idle = pool.idleCount;
            return {
                max: sharedPool.entry.maxConnections,
                total,
                active: Math.max(0, total - idle),
                idle,
                waiting: pool.waitingCount,
            };
        },
    };
};
