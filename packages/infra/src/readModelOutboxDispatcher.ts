import { parseReadModelOutboxPayload, type ReadModelOutboxPayloadV1 } from '@sammo-ts/common';

import { GamePrisma, type GamePrismaClient } from './gamePrisma.js';

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
    db: GamePrismaClient,
    options: Pick<ReadModelOutboxDispatchOptions, 'owner' | 'limit' | 'leaseMs'> & { now?: Date }
): Promise<ClaimedReadModelOutbox[]> => {
    if (!options.owner.trim()) {
        throw new Error('Read-model outbox owner must not be empty.');
    }
    const limit = normalizeLimit(options.limit);
    const leaseMs = normalizeDuration(options.leaseMs, 30_000);
    const now = options.now ?? new Date();
    const leaseExpiredBefore = new Date(now.getTime() - leaseMs);
    const rows = await db.$queryRaw<ClaimedRow[]>(GamePrisma.sql`
        WITH candidates AS (
            SELECT "id"
            FROM "read_model_outbox"
            WHERE "delivered_at" IS NULL
              AND "available_at" <= ${now}
              AND ("locked_at" IS NULL OR "locked_at" < ${leaseExpiredBefore})
            ORDER BY "id"
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
        )
        UPDATE "read_model_outbox" AS outbox
        SET
            "attempts" = outbox."attempts" + 1,
            "locked_at" = ${now},
            "lock_owner" = ${options.owner},
            "last_error" = NULL
        FROM candidates
        WHERE outbox."id" = candidates."id"
        RETURNING outbox."id", outbox."payload", outbox."attempts"
    `);

    return rows.map((row) => ({ id: BigInt(row.id), payload: row.payload, attempts: row.attempts }));
};

export const markReadModelOutboxDelivered = async (
    db: GamePrismaClient,
    input: { id: bigint; owner: string; deliveredAt?: Date }
): Promise<boolean> => {
    const result = await db.readModelOutbox.updateMany({
        where: { id: input.id, lockOwner: input.owner, deliveredAt: null },
        data: {
            deliveredAt: input.deliveredAt ?? new Date(),
            lockedAt: null,
            lockOwner: null,
            lastError: null,
        },
    });
    return result.count === 1;
};

export const releaseReadModelOutbox = async (
    db: GamePrismaClient,
    input: { id: bigint; owner: string; error: unknown; availableAt: Date }
): Promise<boolean> => {
    const result = await db.readModelOutbox.updateMany({
        where: { id: input.id, lockOwner: input.owner, deliveredAt: null },
        data: {
            availableAt: input.availableAt,
            lockedAt: null,
            lockOwner: null,
            lastError: formatDispatchError(input.error),
        },
    });
    return result.count === 1;
};

export const dispatchReadModelOutboxBatch = async (
    db: GamePrismaClient,
    publish: (payload: ReadModelOutboxPayloadV1, outboxId: bigint) => Promise<void>,
    options: ReadModelOutboxDispatchOptions
): Promise<ReadModelOutboxDispatchResult> => {
    const now = options.now ?? (() => new Date());
    const retryBaseMs = normalizeDuration(options.retryBaseMs, 1_000);
    const retryMaxMs = Math.max(retryBaseMs, normalizeDuration(options.retryMaxMs, 60_000));
    const claimed = await claimReadModelOutboxBatch(db, {
        owner: options.owner,
        limit: options.limit,
        leaseMs: options.leaseMs,
        now: now(),
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
            if (!(await markReadModelOutboxDelivered(db, { id: item.id, owner: options.owner, deliveredAt: now() }))) {
                throw new Error(`Read-model outbox ${item.id.toString()} lost its delivery lease.`);
            }
            delivered += 1;
        } catch (error) {
            failed += 1;
            await releaseReadModelOutbox(db, {
                id: item.id,
                owner: options.owner,
                error,
                availableAt: new Date(now().getTime() + retryDelayMs(item.attempts, retryBaseMs, retryMaxMs)),
            });
        }
    }

    return { claimed: claimed.length, delivered, failed };
};

export const pruneDeliveredReadModelOutbox = async (
    db: GamePrismaClient,
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
