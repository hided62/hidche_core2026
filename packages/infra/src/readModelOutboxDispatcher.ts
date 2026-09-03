import { parseReadModelOutboxPayload, type ReadModelOutboxPayloadV1 } from '@sammo-ts/common';

import { GamePrisma, type GamePrismaClient } from './gamePrisma.js';

export interface ReadModelOutboxDatabase extends Pick<GamePrismaClient, '$queryRaw' | '$executeRaw'> {
    readModelOutbox: GamePrisma.ReadModelOutboxDelegate;
}

export interface ClaimedReadModelOutbox {
    id: bigint;
    payload: unknown;
    attempts: number;
}

type ClaimedRow = {
    id: bigint;
    payload: unknown;
    attempts: number;
};

export interface ReadModelOutboxDispatchOptions {
    owner: string;
    limit?: number;
    leaseMs?: number;
    retryBaseMs?: number;
    retryMaxMs?: number;
    now?: () => Date;
}

export interface ReadModelOutboxDispatchResult {
    claimed: number;
    delivered: number;
    failed: number;
}

const normalizeLimit = (value: number | undefined): number =>
    Math.min(500, Math.max(1, Math.floor(value ?? 50)));

const normalizeDuration = (value: number | undefined, fallback: number): number =>
    Math.max(1, Math.floor(value ?? fallback));

const formatDispatchError = (error: unknown): string => {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return text.replaceAll(/\s+/gu, ' ').slice(0, 1_000);
};

const retryDelayMs = (attempts: number, baseMs: number, maxMs: number): number => {
    const exponent = Math.min(20, Math.max(0, attempts - 1));
    return Math.min(maxMs, baseMs * 2 ** exponent);
};

export const claimReadModelOutboxBatch = async (
    db: ReadModelOutboxDatabase,
    options: Pick<ReadModelOutboxDispatchOptions, 'owner' | 'limit' | 'leaseMs'> & { now?: Date }
): Promise<ClaimedReadModelOutbox[]> => {
    if (!options.owner.trim()) {
        throw new Error('Read-model outbox owner must not be empty.');
    }
    const limit = normalizeLimit(options.limit);
    const leaseMs = normalizeDuration(options.leaseMs, 30_000);
    const nowSql = options.now
        ? GamePrisma.sql`${options.now}`
        : GamePrisma.sql`(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;
    const rows = await db.$queryRaw<ClaimedRow[]>(GamePrisma.sql`
        WITH candidates AS (
            SELECT "id"
            FROM "read_model_outbox"
            WHERE "delivered_at" IS NULL
              AND "available_at" <= ${nowSql}
              AND ("locked_at" IS NULL OR "locked_at" < ${nowSql} - ${leaseMs} * INTERVAL '1 millisecond')
            ORDER BY "id"
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
        )
        UPDATE "read_model_outbox" AS outbox
        SET
            "attempts" = outbox."attempts" + 1,
            "locked_at" = ${nowSql},
            "lock_owner" = ${options.owner},
            "last_error" = NULL
        FROM candidates
        WHERE outbox."id" = candidates."id"
        RETURNING outbox."id", outbox."payload", outbox."attempts"
    `);

    return rows.map((row) => ({ id: BigInt(row.id), payload: row.payload, attempts: row.attempts }));
};

export const markReadModelOutboxDelivered = async (
    db: ReadModelOutboxDatabase,
    input: { id: bigint; owner: string; deliveredAt?: Date }
): Promise<boolean> => {
    const deliveredAtSql = input.deliveredAt
        ? GamePrisma.sql`${input.deliveredAt}`
        : GamePrisma.sql`(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;
    return (
        (await db.$executeRaw(GamePrisma.sql`
            UPDATE "read_model_outbox"
            SET "delivered_at" = ${deliveredAtSql},
                "locked_at" = NULL,
                "lock_owner" = NULL,
                "last_error" = NULL
            WHERE "id" = ${input.id}
              AND "lock_owner" = ${input.owner}
              AND "delivered_at" IS NULL
        `)) === 1
    );
};

export const releaseReadModelOutbox = async (
    db: ReadModelOutboxDatabase,
    input: { id: bigint; owner: string; error: unknown; availableAt?: Date; availableAfterMs?: number }
): Promise<boolean> => {
    const availableAtSql = input.availableAt
        ? GamePrisma.sql`${input.availableAt}`
        : GamePrisma.sql`(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            + ${normalizeDuration(input.availableAfterMs, 1_000)} * INTERVAL '1 millisecond'`;
    return (
        (await db.$executeRaw(GamePrisma.sql`
            UPDATE "read_model_outbox"
            SET "available_at" = ${availableAtSql},
                "locked_at" = NULL,
                "lock_owner" = NULL,
                "last_error" = ${formatDispatchError(input.error)}
            WHERE "id" = ${input.id}
              AND "lock_owner" = ${input.owner}
              AND "delivered_at" IS NULL
        `)) === 1
    );
};

export const dispatchReadModelOutboxBatch = async (
    db: ReadModelOutboxDatabase,
    publish: (payload: ReadModelOutboxPayloadV1, outboxId: bigint) => Promise<void>,
    options: ReadModelOutboxDispatchOptions
): Promise<ReadModelOutboxDispatchResult> => {
    const testNow = options.now;
    const retryBaseMs = normalizeDuration(options.retryBaseMs, 1_000);
    const retryMaxMs = Math.max(retryBaseMs, normalizeDuration(options.retryMaxMs, 60_000));
    const claimed = await claimReadModelOutboxBatch(db, {
        owner: options.owner,
        limit: options.limit,
        leaseMs: options.leaseMs,
        ...(testNow ? { now: testNow() } : {}),
    });
    let delivered = 0;
    let failed = 0;

    for (const item of claimed) {
        try {
            const payload = parseReadModelOutboxPayload(item.payload);
            if (!payload) {
                throw new Error(`Read-model outbox ${item.id.toString()} has an invalid payload.`);
            }
            await publish(payload, item.id);
            if (
                !(await markReadModelOutboxDelivered(db, {
                    id: item.id,
                    owner: options.owner,
                    ...(testNow ? { deliveredAt: testNow() } : {}),
                }))
            ) {
                throw new Error(`Read-model outbox ${item.id.toString()} lost its delivery lease.`);
            }
            delivered += 1;
        } catch (error) {
            failed += 1;
            await releaseReadModelOutbox(db, {
                id: item.id,
                owner: options.owner,
                error,
                ...(testNow
                    ? { availableAt: new Date(testNow().getTime() + retryDelayMs(item.attempts, retryBaseMs, retryMaxMs)) }
                    : { availableAfterMs: retryDelayMs(item.attempts, retryBaseMs, retryMaxMs) }),
            });
        }
    }

    return { claimed: claimed.length, delivered, failed };
};

export const pruneDeliveredReadModelOutbox = async (
    db: ReadModelOutboxDatabase,
    input: { deliveredBefore: Date; limit?: number }
): Promise<number> => {
    const limit = normalizeLimit(input.limit);
    const rows = await db.$queryRaw<Array<{ id: bigint }>>(GamePrisma.sql`
        DELETE FROM "read_model_outbox"
        WHERE "id" IN (
            SELECT "id"
            FROM "read_model_outbox"
            WHERE "delivered_at" < ${input.deliveredBefore}
            ORDER BY "id"
            LIMIT ${limit}
        )
        RETURNING "id"
    `);
    return rows.length;
};
