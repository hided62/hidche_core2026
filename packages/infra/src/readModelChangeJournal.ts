import {
    isReadModelDomain,
    normalizeReadModelRevisionKeys,
    READ_MODEL_OUTBOX_PAYLOAD_VERSION,
    type CommittedReadModelInvalidation,
    type ReadModelRevisionKey,
} from '@sammo-ts/common';

import { GamePrisma, type GamePrismaClient } from './gamePrisma.js';

export type ReadModelJournalDatabase = Pick<GamePrismaClient, '$queryRaw'>;

interface ReadModelJournalWriteRow {
    domain: string;
    entityId: number;
    revision: bigint;
    outboxId: bigint;
}

export interface ReadModelJournalWriteResult {
    invalidation: CommittedReadModelInvalidation;
    /** Delivery identity only. It must not be used as a projection revision. */
    outboxId: bigint;
}

const assertWriteRows = (
    keys: readonly ReadModelRevisionKey[],
    rows: readonly ReadModelJournalWriteRow[]
): ReadModelJournalWriteResult => {
    if (rows.length !== keys.length) {
        throw new Error(`Read-model journal wrote ${rows.length} revisions for ${keys.length} keys.`);
    }

    const first = rows[0];
    if (!first) {
        throw new Error('Read-model journal write did not return an outbox ID.');
    }
    const outboxId = BigInt(first.outboxId);
    const revisions = rows.map((row, index) => {
        const key = keys[index];
        if (!key || !isReadModelDomain(row.domain) || row.domain !== key.domain || row.entityId !== key.entityId) {
            throw new Error('Read-model journal write returned revisions in an unexpected key order.');
        }
        if (BigInt(row.outboxId) !== outboxId) {
            throw new Error('Read-model journal write returned more than one outbox row.');
        }
        return {
            domain: row.domain,
            entityId: row.entityId,
            revision: BigInt(row.revision),
        };
    });

    return {
        invalidation: { revisions },
        outboxId,
    };
};

/**
 * Atomically increments every normalized revision key and stores exactly one
 * compact outbox payload. The caller must pass the existing Prisma transaction
 * that owns the domain mutation; this function never opens or commits one.
 */
export const writeReadModelChangeJournal = async (
    transaction: ReadModelJournalDatabase,
    candidates: Iterable<ReadModelRevisionKey>
): Promise<ReadModelJournalWriteResult | null> => {
    const keys = normalizeReadModelRevisionKeys(candidates);
    if (keys.length === 0) {
        return null;
    }

    const requestedRows = keys.map(({ domain, entityId }) => GamePrisma.sql`(${domain}::text, ${entityId}::integer)`);
    const rows = await transaction.$queryRaw<ReadModelJournalWriteRow[]>(GamePrisma.sql`
        WITH requested("domain", "entity_id") AS (
            VALUES ${GamePrisma.join(requestedRows)}
        ),
        bumped AS (
            INSERT INTO "read_model_revision" (
                "domain",
                "entity_id",
                "revision",
                "updated_at"
            )
            SELECT
                requested."domain",
                requested."entity_id",
                1,
                CURRENT_TIMESTAMP
            FROM requested
            ORDER BY requested."domain", requested."entity_id"
            ON CONFLICT ("domain", "entity_id") DO UPDATE
            SET
                "revision" = "read_model_revision"."revision" + 1,
                "updated_at" = CURRENT_TIMESTAMP
            RETURNING "domain", "entity_id", "revision"
        ),
        outbox_payload AS (
            SELECT jsonb_build_object(
                'version', ${READ_MODEL_OUTBOX_PAYLOAD_VERSION}::integer,
                'changes', jsonb_agg(
                    jsonb_build_array("domain", "entity_id", "revision"::text)
                    ORDER BY "domain", "entity_id"
                )
            ) AS "payload"
            FROM bumped
        ),
        inserted_outbox AS (
            INSERT INTO "read_model_outbox" ("payload")
            SELECT "payload" FROM outbox_payload
            RETURNING "id"
        )
        SELECT
            bumped."domain",
            bumped."entity_id" AS "entityId",
            bumped."revision",
            inserted_outbox."id" AS "outboxId"
        FROM bumped
        CROSS JOIN inserted_outbox
        ORDER BY bumped."domain", bumped."entity_id"
    `);

    return assertWriteRows(keys, rows);
};
