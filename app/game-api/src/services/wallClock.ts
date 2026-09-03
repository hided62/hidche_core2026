import { GamePrisma } from '@sammo-ts/infra';

import type { DatabaseClient } from '../context.js';

/** Reads the authoritative PostgreSQL UTC wall instant for business rules. */
export const readDatabaseWallTime = async (db: Pick<DatabaseClient, '$queryRaw'>): Promise<Date> => {
    const rows = await db.$queryRaw<Array<{ wallNow: Date }>>(GamePrisma.sql`
        SELECT CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AS "wallNow"
    `);
    const wallNow = rows[0]?.wallNow;
    if (!wallNow) throw new Error('Failed to read PostgreSQL wall time.');
    return new Date(wallNow);
};
