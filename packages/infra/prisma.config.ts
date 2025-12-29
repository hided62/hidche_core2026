import 'dotenv/config';

import { defineConfig } from 'prisma/config';

const buildDatabaseUrlFromEnv = (): string => {
    const host = process.env.POSTGRES_HOST ?? '127.0.0.1';
    const port = process.env.POSTGRES_PORT ?? '15432';
    const user = process.env.POSTGRES_USER ?? 'sammo';
    const password = process.env.POSTGRES_PASSWORD ?? '';
    const dbName = process.env.POSTGRES_DB ?? 'sammo';
    return `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
};

const databaseUrl =
    process.env.DATABASE_URL ?? buildDatabaseUrlFromEnv();

export default defineConfig({
    schema: 'prisma/schema.prisma',
    datasource: {
        url: databaseUrl,
    },
});
