import { GamePrisma, type GamePrismaClient } from './gamePrisma.js';

type GameSchemaAdvisoryLockDatabase = Pick<GamePrismaClient, '$executeRaw' | '$queryRaw'>;

interface TryLockRow {
    acquired: boolean;
}

/** Serializes score/traffic writers whose table lock order otherwise differs by entry point. */
export const GENERAL_ACCESS_PERSISTENCE_LOCK = 'general-access:persistence';
/** Serializes phase/revision changes with every gameplay flush in one game schema. */
export const CLOCK_OPERATION_PERSISTENCE_LOCK = 'game-clock:operation';

const lockKeySql = (logicalKey: string): GamePrisma.Sql =>
    GamePrisma.sql`hashtextextended(current_schema() || chr(31) || ${logicalKey}, 0)`;

/**
 * Acquires a transaction-scoped lock whose namespace is the active game schema.
 * Callers must already be inside the transaction that owns the protected write.
 */
export const acquireGameSchemaAdvisoryXactLock = async (
    database: GameSchemaAdvisoryLockDatabase,
    logicalKey: string
): Promise<void> => {
    await database.$executeRaw(GamePrisma.sql`SELECT pg_advisory_xact_lock(${lockKeySql(logicalKey)})`);
};

/** Test and diagnostics boundary matching acquireGameSchemaAdvisoryXactLock. */
export const tryGameSchemaAdvisoryXactLock = async (
    database: GameSchemaAdvisoryLockDatabase,
    logicalKey: string
): Promise<boolean> => {
    const rows = await database.$queryRaw<TryLockRow[]>(
        GamePrisma.sql`SELECT pg_try_advisory_xact_lock(${lockKeySql(logicalKey)}) AS acquired`
    );
    return rows[0]?.acquired === true;
};
