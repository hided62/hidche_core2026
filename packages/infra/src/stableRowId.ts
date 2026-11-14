import { GamePrisma } from './gamePrisma.js';

/** Internal natural-key records retain their identity across ordinary updates. */
export const upsertWithoutSequence = async <Where, Update, Create>(
    delegate: {
        update(args: { where: Where; data: Update }): PromiseLike<object>;
        upsert(args: { where: Where; update: Update; create: Create }): PromiseLike<object>;
    },
    args: { where: Where; update: Update; create: Create }
): Promise<void> => {
    try {
        await delegate.update({ where: args.where, data: args.update });
    } catch (error) {
        if (!(error instanceof GamePrisma.PrismaClientKnownRequestError) || error.code !== 'P2025') throw error;
        // A missing row is an application-level Prisma result, not a failed SQL
        // statement. The surrounding transaction remains usable. A competing
        // creator is still handled atomically by the original native upsert.
        await delegate.upsert(args);
    }
};

export type StableIdTable = 'general_access_log' | 'traffic_period' | 'rank_data' | 'inheritance_point' | 'vote';

/** Only new natural keys allocate an ID; values and identifiers stay separate. */
export const existingRowIdOrNext = (table: StableIdTable, predicate: GamePrisma.Sql): GamePrisma.Sql =>
    GamePrisma.sql`COALESCE(
        (SELECT stable_id."id" FROM ${GamePrisma.raw(`"${table}"`)} AS stable_id WHERE ${predicate}),
        nextval(pg_get_serial_sequence(${table}, 'id'))
    )`;
