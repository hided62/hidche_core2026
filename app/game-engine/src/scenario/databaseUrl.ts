import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ENV_FILE = path.resolve(__dirname, '..', '..', '..', '..', '.env.ci');

type EnvMap = Record<string, string | undefined>;

export interface DatabaseUrlOptions {
    envFile?: string;
    env?: NodeJS.ProcessEnv;
    schema?: string;
}

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
    try {
        const text = await fs.readFile(envFile, 'utf8');
        return parseEnvFile(text);
    } catch {
        return {};
    }
};

const applySchemaToDatabaseUrl = (url: string, schema: string | undefined): string => {
    if (!schema) {
        return url;
    }
    try {
        const parsed = new URL(url);
        parsed.searchParams.set('schema', schema);
        return parsed.toString();
    } catch {
        return url;
    }
};

export const resolveDatabaseUrl = async (options?: DatabaseUrlOptions): Promise<string> => {
    const env = options?.env ?? process.env;
    if (env.DATABASE_URL) {
        const schema = options?.schema ?? env.POSTGRES_SCHEMA ?? env.DATABASE_SCHEMA;
        return applySchemaToDatabaseUrl(env.DATABASE_URL, schema);
    }

    const envFile = options?.envFile ?? DEFAULT_ENV_FILE;
    const fileEnv = await loadEnvFile(envFile);
    if (fileEnv.DATABASE_URL) {
        const schema = options?.schema ?? fileEnv.POSTGRES_SCHEMA ?? fileEnv.DATABASE_SCHEMA;
        return applySchemaToDatabaseUrl(fileEnv.DATABASE_URL, schema);
    }

    const host = env.POSTGRES_HOST ?? fileEnv.POSTGRES_HOST ?? '127.0.0.1';
    const port = env.POSTGRES_PORT ?? fileEnv.POSTGRES_PORT ?? '15432';
    const user = env.POSTGRES_USER ?? fileEnv.POSTGRES_USER ?? 'sammo';
    const password = env.POSTGRES_PASSWORD ?? fileEnv.POSTGRES_PASSWORD ?? '';
    const dbName = env.POSTGRES_DB ?? fileEnv.POSTGRES_DB ?? 'sammo';
    const schema =
        options?.schema ??
        env.POSTGRES_SCHEMA ??
        fileEnv.POSTGRES_SCHEMA ??
        env.DATABASE_SCHEMA ??
        fileEnv.DATABASE_SCHEMA ??
        'public';
    return `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=${schema}`;
};
