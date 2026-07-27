import 'dotenv/config';

import { defineConfig } from 'prisma/config';

const databaseUrl = process.env.GATEWAY_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error('GATEWAY_DATABASE_URL or DATABASE_URL is required for gateway migrations.');
}

export default defineConfig({
    schema: 'prisma/gateway.prisma',
    migrations: {
        path: 'prisma/gateway-migrations',
    },
    datasource: {
        url: databaseUrl,
    },
});
