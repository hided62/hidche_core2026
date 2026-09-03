import { createHash } from 'node:crypto';

import {
    CLOCK_OPERATION_PERSISTENCE_LOCK,
    GamePrisma,
    acquireGameSchemaAdvisoryXactLock,
    type DatabaseClient as InfraDatabaseClient,
} from '@sammo-ts/infra';

import type { DatabaseClient } from './context.js';

const API_INPUT_PAYLOAD_VERSION = 1 as const;
const BUSINESS_SAVEPOINT = 'api_input_event_business';

export interface ApiInputPayloadIdentity {
    version: typeof API_INPUT_PAYLOAD_VERSION;
    digest: string;
}

interface LockedInputEvent {
    target: 'API' | 'ENGINE';
    eventType: string;
    payload: GamePrisma.JsonValue;
    actorUserId: string | null;
    status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
    result: GamePrisma.JsonValue | null;
    attempts: number;
}

type InputEventOutcome<T> =
    { kind: 'executed'; value: T } | { kind: 'replayed'; value: T } | { kind: 'failed'; error: unknown };

type SavepointDatabaseClient = InfraDatabaseClient & {
    $executeRawUnsafe(query: string): Promise<number>;
};

const canonicalJson = (value: unknown): string =>
    JSON.stringify(value, (_key, entry: unknown) => {
        if (typeof entry === 'bigint') {
            return entry.toString();
        }
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            return Object.fromEntries(
                Object.entries(entry as Record<string, unknown>).sort(([left], [right]) =>
                    left < right ? -1 : left > right ? 1 : 0
                )
            );
        }
        return entry;
    }) ?? 'null';

const canonicalJsonValue = (value: unknown): GamePrisma.InputJsonValue =>
    JSON.parse(canonicalJson(value)) as GamePrisma.InputJsonValue;

export const createApiInputPayloadIdentity = (payload: unknown): ApiInputPayloadIdentity => ({
    version: API_INPUT_PAYLOAD_VERSION,
    digest: `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`,
});

const isLegacyEmptyPayload = (payload: GamePrisma.JsonValue): boolean =>
    payload !== null && !Array.isArray(payload) && typeof payload === 'object' && Object.keys(payload).length === 0;

const sameJson = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);

export class DuplicateInputEventError extends Error {
    constructor(readonly requestId: string) {
        super(`Input event ${requestId} conflicts with an existing request.`);
        this.name = 'DuplicateInputEventError';
    }
}

const insertPendingIfAbsent = async (
    db: DatabaseClient,
    options: {
        requestId: string;
        eventType: string;
        actorUserId: string | null;
        payloadIdentity: ApiInputPayloadIdentity;
    }
): Promise<void> => {
    await db.$executeRaw(
        GamePrisma.sql`
            INSERT INTO input_event (
                request_id,
                target,
                event_type,
                payload,
                actor_user_id,
                status,
                attempts,
                accepted_game_tick,
                accepted_clock_revision,
                accepted_deadline_generation,
                created_at
            )
            VALUES (
                ${options.requestId},
                'API'::"InputEventTarget",
                ${options.eventType},
                CAST(${JSON.stringify(options.payloadIdentity)} AS jsonb),
                ${options.actorUserId},
                'PENDING'::"InputEventStatus",
                0,
                NULL,
                NULL,
                NULL,
                CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
            )
            ON CONFLICT (request_id) DO NOTHING
        `
    );
};

const lockInputEvent = async (db: DatabaseClient, requestId: string): Promise<LockedInputEvent> => {
    const rows = await db.$queryRaw<LockedInputEvent[]>(
        GamePrisma.sql`
            SELECT
                target,
                event_type AS "eventType",
                payload,
                actor_user_id AS "actorUserId",
                status,
                result,
                attempts
            FROM input_event
            WHERE request_id = ${requestId}
            FOR UPDATE
        `
    );
    const row = rows[0];
    if (!row) {
        throw new Error(`Input event ${requestId} disappeared while being claimed.`);
    }
    return row;
};

const hasMatchingBaseIdentity = (
    row: LockedInputEvent,
    options: { eventType: string; actorUserId: string | null }
): boolean => row.target === 'API' && row.eventType === options.eventType && row.actorUserId === options.actorUserId;

const canAdoptLegacyFailedPayload = (
    row: LockedInputEvent,
    options: { eventType: string; actorUserId: string | null }
): boolean =>
    row.status === 'FAILED' &&
    row.result === null &&
    isLegacyEmptyPayload(row.payload) &&
    hasMatchingBaseIdentity(row, options);

const isMatchingIdentity = (
    row: LockedInputEvent,
    options: {
        eventType: string;
        actorUserId: string | null;
        payloadIdentity: ApiInputPayloadIdentity;
    }
): boolean => hasMatchingBaseIdentity(row, options) && sameJson(row.payload, options.payloadIdentity);

const claimInputEvent = async (
    db: DatabaseClient,
    requestId: string,
    payloadIdentity: ApiInputPayloadIdentity
): Promise<void> => {
    await db.$executeRaw(GamePrisma.sql`
        UPDATE input_event
        SET payload = CAST(${JSON.stringify(payloadIdentity)} AS jsonb),
            status = 'PROCESSING'::"InputEventStatus",
            result = NULL,
            error = NULL,
            attempts = attempts + 1,
            locked_by = NULL,
            lease_until = NULL,
            processing_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
            processing_game_tick = NULL,
            processing_clock_revision = NULL,
            processing_deadline_generation = NULL,
            completed_at = NULL
        WHERE request_id = ${requestId}
    `);
};

const markUnexpectedFailure = async (
    db: DatabaseClient,
    options: {
        requestId: string;
        eventType: string;
        actorUserId: string | null;
        payloadIdentity: ApiInputPayloadIdentity;
        error: unknown;
        acquireClockFence: boolean;
    }
): Promise<void> => {
    if (!db.$transaction) return;
    const message = options.error instanceof Error ? options.error.message : 'Unknown API input event error.';

    try {
        await db.$transaction(async (transaction) => {
            if (options.acquireClockFence) {
                await acquireGameSchemaAdvisoryXactLock(transaction, CLOCK_OPERATION_PERSISTENCE_LOCK);
            }
            await insertPendingIfAbsent(transaction, options);
            const row = await lockInputEvent(transaction, options.requestId);
            const identityMatches = isMatchingIdentity(row, options) || canAdoptLegacyFailedPayload(row, options);
            if (!identityMatches || row.status === 'SUCCEEDED' || row.status === 'PROCESSING') {
                // A retry may have committed while the failed caller was unwinding. A
                // late failure recorder must never replace its durable success.
                return;
            }
            await transaction.$executeRaw(GamePrisma.sql`
                UPDATE input_event
                SET payload = CAST(${JSON.stringify(options.payloadIdentity)} AS jsonb),
                    status = 'FAILED'::"InputEventStatus",
                    result = NULL,
                    error = ${message},
                    attempts = attempts + 1,
                    locked_by = NULL,
                    lease_until = NULL,
                    processing_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
                    completed_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                WHERE request_id = ${options.requestId}
            `);
        });
    } catch {
        // Preserve the transaction failure that the caller actually observed. If
        // the database is unavailable, the prior PENDING/FAILED state (or absence
        // of a newly rolled-back row) remains safely retryable.
    }
};

export const executeInputEvent = async <T>(options: {
    db: DatabaseClient;
    requestId: string;
    eventType: string;
    payload: unknown;
    actorUserId?: string | null;
    acquireClockFence?: boolean;
    execute(db: DatabaseClient): Promise<T>;
}): Promise<T> => {
    const { db, requestId, eventType, payload, execute } = options;
    const actorUserId = options.actorUserId ?? null;
    const acquireClockFence = options.acquireClockFence !== false;
    const payloadIdentity = createApiInputPayloadIdentity(payload);
    if (!db.$transaction) {
        return execute(db);
    }

    let businessStarted = false;
    let outcome: InputEventOutcome<T>;
    try {
        outcome = await db.$transaction(async (transaction) => {
            if (acquireClockFence) {
                await acquireGameSchemaAdvisoryXactLock(transaction, CLOCK_OPERATION_PERSISTENCE_LOCK);
            }
            await insertPendingIfAbsent(transaction, { requestId, eventType, actorUserId, payloadIdentity });
            const row = await lockInputEvent(transaction, requestId);
            const identityMatches = isMatchingIdentity(row, { eventType, actorUserId, payloadIdentity });

            if (row.status === 'SUCCEEDED') {
                if (!identityMatches) throw new DuplicateInputEventError(requestId);
                return { kind: 'replayed', value: row.result as T };
            }
            // A visible PROCESSING row was committed by the legacy boundary. It
            // may still have an active business request and its {} payload cannot
            // prove identity, so automatic reclaim would risk duplicate writes.
            if (row.status === 'PROCESSING') {
                throw new DuplicateInputEventError(requestId);
            }
            if (!identityMatches && !canAdoptLegacyFailedPayload(row, { eventType, actorUserId })) {
                throw new DuplicateInputEventError(requestId);
            }

            await claimInputEvent(transaction, requestId, payloadIdentity);
            const savepointDb = transaction as SavepointDatabaseClient;
            await savepointDb.$executeRawUnsafe(`SAVEPOINT ${BUSINESS_SAVEPOINT}`);
            businessStarted = true;
            try {
                const value = await execute(transaction);
                const durableResult = canonicalJsonValue(value);
                await transaction.$executeRaw(GamePrisma.sql`
                    UPDATE input_event
                    SET status = 'SUCCEEDED'::"InputEventStatus",
                        result = CAST(${JSON.stringify(durableResult)} AS jsonb),
                        error = NULL,
                        completed_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                    WHERE request_id = ${requestId}
                `);
                await savepointDb.$executeRawUnsafe(`RELEASE SAVEPOINT ${BUSINESS_SAVEPOINT}`);
                return { kind: 'executed', value };
            } catch (error) {
                await savepointDb.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${BUSINESS_SAVEPOINT}`);
                await savepointDb.$executeRawUnsafe(`RELEASE SAVEPOINT ${BUSINESS_SAVEPOINT}`);
                const message = error instanceof Error ? error.message : 'Unknown API input event error.';
                await transaction.$executeRaw(GamePrisma.sql`
                    UPDATE input_event
                    SET status = 'FAILED'::"InputEventStatus",
                        result = NULL,
                        error = ${message},
                        completed_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                    WHERE request_id = ${requestId}
                `);
                return { kind: 'failed', error };
            }
        });
    } catch (error) {
        if (businessStarted && !(error instanceof DuplicateInputEventError)) {
            await markUnexpectedFailure(db, {
                requestId,
                eventType,
                actorUserId,
                payloadIdentity,
                error,
                acquireClockFence,
            });
        }
        throw error;
    }

    if (outcome.kind === 'failed') {
        throw outcome.error;
    }
    return outcome.value;
};
