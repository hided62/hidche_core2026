import { PrismaClient as GamePrismaClient } from '../prisma/generated/game/index.js';
export { LogCategory, LogScope, Prisma as GamePrisma } from '../prisma/generated/game/index.js';
export type { PrismaClient as GamePrismaClient } from '../prisma/generated/game/index.js';

import type { PostgresConfig, PostgresConnector } from './postgres.js';
import { createPostgresConnector } from './postgres.js';

export const createGamePostgresConnector = (config: PostgresConfig): PostgresConnector<GamePrismaClient> =>
    createPostgresConnector(config, (options) => new GamePrismaClient(options));
