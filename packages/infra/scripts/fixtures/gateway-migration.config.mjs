import { defineConfig } from 'prisma/config';

export default defineConfig({
    schema: './gateway.prisma',
    migrations: { path: './gateway-migrations' },
    datasource: { url: process.env.GATEWAY_DATABASE_URL },
});
