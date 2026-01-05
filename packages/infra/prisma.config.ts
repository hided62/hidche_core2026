import 'dotenv/config';

import { defineConfig } from 'prisma/config';

const resolveSchemaName = (value: string | undefined): string => {
    if (!value) {
        return 'public';
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : 'public';
};

const buildDatabaseUrlFromEnv = (): string => {
    const host = process.env.POSTGRES_HOST ?? '127.0.0.1';
    const port = process.env.POSTGRES_PORT ?? '15432';
    const user = process.env.POSTGRES_USER ?? 'sammo';
    const password = process.env.POSTGRES_PASSWORD ?? '';
    const dbName = process.env.POSTGRES_DB ?? 'sammo';
    const schema = resolveSchemaName(process.env.POSTGRES_SCHEMA ?? process.env.DATABASE_SCHEMA);
    return `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=${schema}`;
};

const databaseUrl = process.env.DATABASE_URL ?? buildDatabaseUrlFromEnv();

const schemaPath = process.env.PRISMA_SCHEMA ?? 'prisma/game.prisma';

export default defineConfig({
    schema: schemaPath,
    datasource: {
        url: databaseUrl,
    },
});
