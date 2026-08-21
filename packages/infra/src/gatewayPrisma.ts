import { PrismaClient as GatewayPrismaClient } from '../prisma/generated/gateway/index.js';
export { Prisma as GatewayPrisma } from '../prisma/generated/gateway/index.js';
export type { PrismaClient as GatewayPrismaClient } from '../prisma/generated/gateway/index.js';

import type { PostgresConfig, PostgresConnector } from './postgres.js';
import { createPostgresConnector } from './postgres.js';

export const createGatewayPostgresConnector = (config: PostgresConfig): PostgresConnector<GatewayPrismaClient> =>
    createPostgresConnector({ ...config, sessionTimezone: 'UTC' }, (options) => new GatewayPrismaClient(options));
