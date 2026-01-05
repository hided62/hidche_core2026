import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_ENV_FILE = path.resolve(__dirname, '..', '..', '.env.ci');
const INFRA_PACKAGE_JSON = path.resolve(__dirname, '..', '..', 'packages', 'infra', 'package.json');
const infraRequire = createRequire(INFRA_PACKAGE_JSON);
const { PrismaClient } = infraRequire('@prisma/client');
const { PrismaPg } = infraRequire('@prisma/adapter-pg');
const { Pool } = infraRequire('pg');
const { createClient } = infraRequire('redis');

type EnvMap = Record<string, string | undefined>;

const parseEnvFile = (rawText: string): EnvMap => {
    const env: EnvMap = {};
    const lines = rawText.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const index = trimmed.indexOf('=');
        if (index < 0) {
            continue;
        }
        const key = trimmed.slice(0, index).trim();
        let value = trimmed.slice(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    return env;
};

const loadEnvFile = async (envFile: string): Promise<EnvMap> => {
    const text = await fs.readFile(envFile, 'utf8');
    return parseEnvFile(text);
};

const maskUrlPassword = (url: string): string => url.replace(/:(?:[^@]+)@/, ':***@');

const resolveDatabaseUrl = (env: EnvMap): string => {
    if (process.env.DATABASE_URL) {
        return process.env.DATABASE_URL;
    }
    if (env.DATABASE_URL) {
        return env.DATABASE_URL;
    }
    const host = env.POSTGRES_HOST ?? '127.0.0.1';
    const port = env.POSTGRES_PORT ?? '15432';
    const user = env.POSTGRES_USER ?? 'sammo';
    const password = env.POSTGRES_PASSWORD ?? '';
    const dbName = env.POSTGRES_DB ?? 'sammo';
    return `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
};

const resolveRedisUrl = (env: EnvMap): string => {
    if (process.env.REDIS_URL) {
        return process.env.REDIS_URL;
    }
    if (env.REDIS_URL) {
        return env.REDIS_URL;
    }
    const host = env.REDIS_HOST ?? '127.0.0.1';
    const port = env.REDIS_PORT ?? '16379';
    const db = env.REDIS_DB ?? '0';
    const password = env.REDIS_PASSWORD ?? '';
    return `redis://:${password}@${host}:${port}/${db}`;
};

const testPostgres = async (databaseUrl: string): Promise<void> => {
    const pool = new Pool({ connectionString: databaseUrl });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    try {
        await prisma.$connect();
        await prisma.$queryRawUnsafe('SELECT 1');
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
};

const testRedis = async (redisUrl: string): Promise<void> => {
    const client = createClient({ url: redisUrl });
    await client.connect();
    await client.ping();
    await client.quit();
};

const isNodeError = (value: unknown): value is NodeJS.ErrnoException =>
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as NodeJS.ErrnoException).code === 'string';

const formatError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const main = async (): Promise<void> => {
    const envFile = process.env.SAMMO_ENV_FILE ?? DEFAULT_ENV_FILE;
    let env: EnvMap = {};

    try {
        env = await loadEnvFile(envFile);
    } catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') {
            throw error;
        }
    }

    const databaseUrl = resolveDatabaseUrl(env);
    const redisUrl = resolveRedisUrl(env);

    console.log(`Using env file: ${envFile}`);
    console.log(`DATABASE_URL: ${maskUrlPassword(databaseUrl)}`);
    console.log(`REDIS_URL: ${maskUrlPassword(redisUrl)}`);

    const errors: string[] = [];

    try {
        await testPostgres(databaseUrl);
        console.log('Postgres connection: OK');
    } catch (error) {
        console.error('Postgres connection: FAILED');
        console.error(formatError(error));
        errors.push('postgres');
    }

    try {
        await testRedis(redisUrl);
        console.log('Redis connection: OK');
    } catch (error) {
        console.error('Redis connection: FAILED');
        console.error(formatError(error));
        errors.push('redis');
    }

    if (errors.length > 0) {
        process.exitCode = 1;
    }
};

await main();
