import { createHash } from 'node:crypto';

import {
    GAME_TICKS_PER_TURN,
    MAX_SAFE_GAME_TICK,
    GameClock,
    buildClockAlignmentPlan,
    parseClockAlignmentPolicy,
    parseGameClockPhase,
    type ClockAlignmentPolicy,
} from '@sammo-ts/common';
import {
    CLOCK_OPERATION_PERSISTENCE_LOCK,
    GENERAL_ACCESS_PERSISTENCE_LOCK,
    GamePrisma,
    acquireGameSchemaAdvisoryXactLock,
    type GamePrismaClient,
} from '@sammo-ts/infra';

export type ClockSuspensionSource = 'MAINTENANCE' | 'OPEN_DELAY' | 'UNIFICATION_WAIT' | 'RECOVERY';

export type ClockOperationAuthority =
    | { kind: 'DAEMON'; profileName: string; ownerId: string; fencingEpoch: bigint }
    | { kind: 'OFFLINE'; profileName: string; reason: string };

export interface ClockSuspensionResult {
    suspensionId: string;
    phase: 'SUSPENDED';
    sourceRevision: number;
    targetRevision: number;
    cutTick: number;
    cutWallAt: Date;
}

export interface ClockReconciliationResult {
    suspensionId: string;
    phase: 'RECONCILING';
    sourceRevision: number;
    targetRevision: number;
    deadlineGeneration: number;
    gapTicks: number;
    catchUpTicks: number;
    shiftTicks: number;
    alignedTick: number;
    resumeWallAt: Date;
}

interface DbWallRow {
    wallNow: Date;
}

interface LeaseFenceRow {
    ownerId: string;
    fencingEpoch: bigint;
    valid: boolean;
}

interface IdRow {
    id: number;
}

interface TextIdRow {
    id: string;
}

interface ParticipantSnapshot {
    key: string;
    policy: 'SHIFT' | 'KEEP' | 'REBUILD';
    checksum: string;
    count: number;
}

const asJson = (value: unknown): GamePrisma.InputJsonValue => value as GamePrisma.InputJsonValue;

const safeNumber = (value: bigint, label: string): number => {
    const result = Number(value);
    if (!Number.isSafeInteger(result)) {
        throw new Error(`${label} is outside the JavaScript safe integer range: ${value}`);
    }
    return result;
};

const canonicalize = (value: unknown): unknown => {
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, canonicalize(item)])
        );
    }
    return value;
};

const stableJson = (value: unknown): string => JSON.stringify(canonicalize(value));

const checksum = (value: unknown): string => createHash('sha256').update(stableJson(value)).digest('hex');

const aggregateChecksum = (participants: readonly ParticipantSnapshot[]): string =>
    checksum(participants.map(({ key, policy, checksum: value, count }) => ({ key, policy, checksum: value, count })));

const readDbWall = async (db: GamePrisma.TransactionClient): Promise<Date> => {
    const rows = await db.$queryRaw<DbWallRow[]>(GamePrisma.sql`
        SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamp(3) AS "wallNow"
    `);
    const wallNow = rows[0]?.wallNow;
    if (!wallNow || Number.isNaN(wallNow.getTime())) {
        throw new Error('Failed to read the PostgreSQL wall clock.');
    }
    return wallNow;
};

export const readClockDatabaseWall = readDbWall;

const isRetryableSerializableClockError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false;
    const value = error as { code?: unknown; message?: unknown; meta?: unknown };
    const meta =
        value.meta && typeof value.meta === 'object'
            ? (value.meta as { code?: unknown; message?: unknown })
            : undefined;
    const code = typeof value.code === 'string' ? value.code : '';
    const databaseCode = typeof meta?.code === 'string' ? meta.code : '';
    const message = [value.message, meta?.message]
        .filter((entry): entry is string => typeof entry === 'string')
        .join(' ');
    return (
        code === 'P2034' ||
        code === '40001' ||
        databaseCode === '40001' ||
        message.includes('40001') ||
        message.includes('could not serialize access')
    );
};

const runSerializableClockOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
    const maxAttempts = 3;
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            if (attempt >= maxAttempts || !isRetryableSerializableClockError(error)) {
                throw error;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, attempt * 10));
        }
    }
};

const verifyAuthority = async (db: GamePrisma.TransactionClient, authority: ClockOperationAuthority): Promise<void> => {
    const rows = await db.$queryRaw<LeaseFenceRow[]>(GamePrisma.sql`
        SELECT owner_id AS "ownerId",
               fencing_epoch AS "fencingEpoch",
               lease_until > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS valid
        FROM turn_daemon_lease
        WHERE profile = ${authority.profileName}
        FOR UPDATE
    `);
    const lease = rows[0];
    if (authority.kind === 'OFFLINE') {
        if (!authority.reason.trim()) {
            throw new Error('Offline clock operations require an audit reason.');
        }
        if (lease?.valid) {
            throw new Error(`Clock operation requires the ${authority.profileName} daemon lease to be offline.`);
        }
        return;
    }
    if (!lease?.valid || lease.ownerId !== authority.ownerId || lease.fencingEpoch !== authority.fencingEpoch) {
        throw new Error(`Stale turn-daemon fencing authority for profile ${authority.profileName}.`);
    }
};

const lockWorld = async (db: GamePrisma.TransactionClient): Promise<number> => {
    const rows = await db.$queryRaw<IdRow[]>(GamePrisma.sql`
        SELECT id FROM world_state ORDER BY id LIMIT 2 FOR UPDATE
    `);
    if (rows.length !== 1) {
        throw new Error(`Clock reconciliation requires exactly one world_state row; found ${rows.length}.`);
    }
    return rows[0]!.id;
};

const lockParticipants = async (db: GamePrisma.TransactionClient, _cutTick: bigint): Promise<void> => {
    await db.$queryRaw<IdRow[]>(GamePrisma.sql`SELECT id FROM general ORDER BY id FOR UPDATE`);
    await db.$queryRaw<IdRow[]>(GamePrisma.sql`
        SELECT id FROM auction
        WHERE status IN ('OPEN'::auction_status, 'FINALIZING'::auction_status)
        ORDER BY id FOR UPDATE
    `);
    await db.$queryRaw<IdRow[]>(GamePrisma.sql`
        SELECT bid.id
        FROM auction_bid AS bid
        JOIN auction ON auction.id = bid.auction_id
        WHERE auction.status IN ('OPEN'::auction_status, 'FINALIZING'::auction_status)
        ORDER BY bid.id FOR UPDATE OF bid
    `);
    await db.$queryRaw<IdRow[]>(GamePrisma.sql`
        SELECT message_id AS id FROM message_action
        WHERE status = 'PENDING'
        ORDER BY message_id FOR UPDATE
    `);
    await db.$queryRaw<IdRow[]>(GamePrisma.sql`SELECT id FROM inheritance_ledger ORDER BY id FOR UPDATE`);
    await db.$queryRaw<IdRow[]>(GamePrisma.sql`
        SELECT id FROM vote_poll WHERE closed_at IS NULL ORDER BY id FOR UPDATE
    `);
    await db.$queryRaw<IdRow[]>(GamePrisma.sql`
        SELECT id FROM select_pool WHERE general_id IS NULL ORDER BY id FOR UPDATE
    `);
    await db.$queryRaw<TextIdRow[]>(GamePrisma.sql`
        SELECT owner_user_id AS id FROM select_npc_token ORDER BY owner_user_id FOR UPDATE
    `);
};

const readParticipantSnapshots = async (
    db: GamePrisma.TransactionClient,
    worldStateId: number,
    cutTick: bigint
): Promise<ParticipantSnapshot[]> => {
    const [world, generals, auctions, auctionBids, messages, inheritanceEffects, votes, pool, npcTokens, commands] =
        await Promise.all([
            db.worldState.findUniqueOrThrow({
                where: { id: worldStateId },
                select: {
                    clockTick: true,
                    clockRevision: true,
                    deadlineGeneration: true,
                    lastTurnTick: true,
                    meta: true,
                },
            }),
            db.general.findMany({
                orderBy: { id: 'asc' },
                select: { id: true, turnTick: true, recentWarTick: true, meta: true },
            }),
            db.auction.findMany({
                where: { status: { in: ['OPEN', 'FINALIZING'] } },
                orderBy: { id: 'asc' },
                select: { id: true, status: true, openTick: true, closeTick: true },
            }),
            db.auctionBid.findMany({
                where: { auction: { status: { in: ['OPEN', 'FINALIZING'] } } },
                orderBy: { id: 'asc' },
                select: { id: true, occurredGameTick: true },
            }),
            db.messageAction.findMany({
                where: { status: 'PENDING' },
                orderBy: { messageId: 'asc' },
                select: {
                    messageId: true,
                    createdGameTick: true,
                    expiresGameTick: true,
                    clockRevision: true,
                    deadlineGeneration: true,
                },
            }),
            db.inheritanceLedger.findMany({
                orderBy: { id: 'asc' },
                select: { id: true, appliedClockRevision: true, appliedDeadlineGeneration: true },
            }),
            db.votePoll.findMany({
                where: { closedAt: null },
                orderBy: { id: 'asc' },
                select: { id: true, startTick: true, endTick: true },
            }),
            db.selectPoolEntry.findMany({
                where: { generalId: null },
                orderBy: { id: 'asc' },
                select: { id: true, reservedUntilTick: true },
            }),
            db.npcSelectionToken.findMany({
                orderBy: { ownerUserId: 'asc' },
                select: { ownerUserId: true, validUntilTick: true, pickMoreFromTick: true },
            }),
            db.inputEvent.findMany({
                where: { status: { in: ['PENDING', 'PROCESSING'] } },
                orderBy: { sequence: 'asc' },
                select: { sequence: true, acceptedGameTick: true, acceptedClockRevision: true },
            }),
        ]);
    const snapshot = (key: string, policy: ParticipantSnapshot['policy'], rows: unknown[]): ParticipantSnapshot => ({
        key,
        policy,
        checksum: checksum(rows),
        count: rows.length,
    });
    const meta = world.meta && typeof world.meta === 'object' && !Array.isArray(world.meta) ? world.meta : {};
    return [
        snapshot('world-clock', 'REBUILD', [
            {
                clockTick: world.clockTick,
                clockRevision: world.clockRevision,
                deadlineGeneration: world.deadlineGeneration,
            },
        ]),
        snapshot('turn-cursor', 'SHIFT', [{ lastTurnTick: world.lastTurnTick }]),
        snapshot(
            'general-next-turn',
            'SHIFT',
            generals.map(({ id, turnTick }) => ({ id, turnTick }))
        ),
        snapshot(
            'general-recent-war-occurrence',
            'KEEP',
            generals.map(({ id, recentWarTick }) => ({ id, recentWarTick }))
        ),
        snapshot(
            'selection-reselection-deadline',
            'SHIFT',
            generals.flatMap(({ id, meta: generalMeta }) => {
                const raw =
                    generalMeta && typeof generalMeta === 'object' && !Array.isArray(generalMeta)
                        ? Reflect.get(generalMeta, 'next_change_tick')
                        : null;
                const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
                return Number.isSafeInteger(value) && BigInt(value) >= cutTick ? [{ id, nextChangeTick: value }] : [];
            })
        ),
        snapshot(
            'auction-open-occurrence',
            'KEEP',
            auctions.map(({ id, openTick }) => ({ id, openTick }))
        ),
        snapshot(
            'auction-deadline',
            'SHIFT',
            auctions.map(({ id, status, closeTick }) => ({ id, status, closeTick }))
        ),
        snapshot('auction-bid-occurrence', 'KEEP', auctionBids),
        snapshot(
            'auction-finalizing-recovery',
            'REBUILD',
            auctions.map(({ id, status }) => ({ id, status }))
        ),
        snapshot(
            'message-action-occurrence',
            'KEEP',
            messages.map(({ messageId, createdGameTick }) => ({ messageId, createdGameTick }))
        ),
        snapshot(
            'message-action-expiry',
            'SHIFT',
            messages
                .filter(({ expiresGameTick }) => expiresGameTick !== null && expiresGameTick >= cutTick)
                .map(({ messageId, expiresGameTick }) => ({ messageId, expiresGameTick }))
        ),
        snapshot(
            'message-action-clock-coordinate',
            'REBUILD',
            messages.map(({ messageId, clockRevision, deadlineGeneration }) => ({
                messageId,
                clockRevision,
                deadlineGeneration,
            }))
        ),
        snapshot('inheritance-effect-coordinate', 'KEEP', inheritanceEffects),
        snapshot(
            'vote-start-occurrence',
            'KEEP',
            votes.map(({ id, startTick }) => ({ id, startTick }))
        ),
        snapshot(
            'vote-end-deadline',
            'SHIFT',
            votes.map(({ id, endTick }) => ({ id, endTick }))
        ),
        snapshot('select-pool-reservation', 'SHIFT', pool),
        snapshot('npc-selection-window', 'SHIFT', npcTokens),
        snapshot('daemon-command-coordinate', 'KEEP', commands),
        snapshot('movable-json-rule-anchors', 'SHIFT', [
            {
                lastTurnTime: Reflect.get(meta, 'lastTurnTime'),
                turntime: Reflect.get(meta, 'turntime'),
                starttime: Reflect.get(meta, 'starttime'),
                tnmt_time: Reflect.get(meta, 'tnmt_time'),
            },
        ]),
    ];
};

const persistInitialParticipants = async (
    db: GamePrisma.TransactionClient,
    suspensionId: string,
    participants: readonly ParticipantSnapshot[]
): Promise<void> => {
    for (const participant of participants) {
        await db.clockReconciliationParticipant.create({
            data: {
                suspensionId,
                participantKey: participant.key,
                policy: participant.policy,
                beforeChecksum: participant.checksum,
                afterChecksum: participant.checksum,
                affectedCount: 0,
            },
        });
    }
};

/**
 * Locks every registered participant before an enclosing transaction mutates
 * the world into a suspended state. The caller must already hold the daemon,
 * clock-operation, general-access, and world-row lock prefix.
 */
export const prepareClockSuspensionUnderHeldLocks = async (options: {
    db: GamePrisma.TransactionClient;
    cutTick: number;
    cutWallAt?: Date;
}): Promise<{ cutWallAt: Date }> => {
    if (!Number.isSafeInteger(options.cutTick)) {
        throw new Error(`Clock suspension cut tick is outside the safe integer range: ${options.cutTick}.`);
    }
    const cutWallAt = options.cutWallAt ? new Date(options.cutWallAt.getTime()) : await readDbWall(options.db);
    await lockParticipants(options.db, BigInt(options.cutTick));
    return { cutWallAt };
};

/**
 * Persists the ledger after all suspension-boundary gameplay writes have been
 * staged in the same transaction. Lock acquisition belongs to
 * prepareClockSuspensionUnderHeldLocks and must happen first.
 */
export const persistClockSuspensionLedgerUnderHeldLocks = async (options: {
    db: GamePrisma.TransactionClient;
    suspensionId: string;
    worldStateId: number;
    profileName: string;
    source: ClockSuspensionSource;
    cutTick: number;
    cutWallAt: Date;
    rateTicksPerSecond: number;
    sourceRevision: number;
    policy?: ClockAlignmentPolicy;
    catchUpTicks?: number;
}): Promise<void> => {
    if (!options.suspensionId.trim() || options.suspensionId.length > 64) {
        throw new Error('Clock suspension ID must contain 1-64 characters.');
    }
    const policy = options.policy ?? 'EXACT';
    const catchUpTicks = options.catchUpTicks ?? 0;
    if (!Number.isSafeInteger(catchUpTicks) || catchUpTicks < 0) {
        throw new Error('Clock suspension catch-up ticks must be a non-negative safe integer.');
    }
    const existing = await options.db.clockSuspension.findUnique({ where: { id: options.suspensionId } });
    if (existing) {
        if (
            existing.worldStateId !== options.worldStateId ||
            existing.source !== options.source ||
            existing.sourceRevision !== BigInt(options.sourceRevision)
        ) {
            throw new Error(`Clock suspension ID ${options.suspensionId} is already bound to another operation.`);
        }
        return;
    }
    const world = await options.db.worldState.findUniqueOrThrow({ where: { id: options.worldStateId } });
    if (
        parseGameClockPhase(world.clockPhase) !== 'SUSPENDED' ||
        world.clockRevision !== BigInt(options.sourceRevision)
    ) {
        throw new Error('Clock suspension ledger requires a matching durable SUSPENDED world revision.');
    }
    const participants = await readParticipantSnapshots(options.db, options.worldStateId, BigInt(options.cutTick));
    await options.db.clockSuspension.create({
        data: {
            id: options.suspensionId,
            worldStateId: options.worldStateId,
            source: options.source,
            policy,
            status: 'SUSPENDED',
            sourceRevision: BigInt(options.sourceRevision),
            targetRevision: BigInt(options.sourceRevision + 1),
            cutTick: BigInt(options.cutTick),
            cutWallAt: options.cutWallAt,
            rateTicksPerSecond: options.rateTicksPerSecond,
            catchUpTicks: BigInt(catchUpTicks),
            participantChecksumBefore: aggregateChecksum(participants),
            detail: asJson({ authority: 'DAEMON', profileName: options.profileName }),
        },
    });
    await persistInitialParticipants(options.db, options.suspensionId, participants);
};

const shiftMetaDate = (value: unknown, deltaMilliseconds: number): unknown => {
    if (typeof value !== 'string' || !value.trim()) return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Date(parsed.getTime() + deltaMilliseconds).toISOString();
};

const shiftedMeta = (value: GamePrisma.JsonValue, deltaMilliseconds: number): GamePrisma.InputJsonValue => {
    const meta = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
    for (const key of ['lastTurnTime', 'turntime', 'starttime', 'tnmt_time'] as const) {
        if (Object.hasOwn(meta, key)) {
            Reflect.set(meta, key, shiftMetaDate(Reflect.get(meta, key), deltaMilliseconds));
        }
    }
    return asJson(meta);
};

const assertShiftFits = (participants: readonly ParticipantSnapshot[], shiftTicks: number): void => {
    if (!Number.isSafeInteger(shiftTicks) || shiftTicks < 0) {
        throw new Error(`Invalid reconciliation shift: ${shiftTicks}`);
    }
    // Checksums retain stringified values for audit; actual row ranges are
    // checked by PostgreSQL BIGINT and the world aligned tick is checked by the
    // shared GameClock plan. The sentinel expiry is deliberately never shifted.
    if (participants.some((participant) => !participant.checksum)) {
        throw new Error('Participant snapshot is incomplete.');
    }
};

const assertScheduleRanges = async (db: GamePrisma.TransactionClient, shiftTicks: number): Promise<void> => {
    const shift = BigInt(shiftTicks);
    const maximum = BigInt(MAX_SAFE_GAME_TICK) - shift;
    const [general, reselection, auction, message, vote, pool, npcValid, npcMore] = await Promise.all([
        db.general.aggregate({ _max: { turnTick: true }, where: { turnTick: { not: null } } }),
        db.$queryRaw<Array<{ maxTick: bigint | null }>>(GamePrisma.sql`
            SELECT MAX((meta->>'next_change_tick')::bigint) AS "maxTick"
            FROM general
            WHERE meta->>'next_change_tick' ~ '^-?[0-9]+$'
        `),
        db.auction.aggregate({
            _max: { closeTick: true },
            where: { status: { in: ['OPEN', 'FINALIZING'] }, closeTick: { not: null } },
        }),
        db.messageAction.aggregate({
            _max: { expiresGameTick: true },
            where: { status: 'PENDING', expiresGameTick: { not: null } },
        }),
        db.votePoll.aggregate({ _max: { endTick: true }, where: { closedAt: null, endTick: { not: null } } }),
        db.selectPoolEntry.aggregate({
            _max: { reservedUntilTick: true },
            where: { generalId: null, reservedUntilTick: { not: null } },
        }),
        db.npcSelectionToken.aggregate({ _max: { validUntilTick: true }, where: { validUntilTick: { not: null } } }),
        db.npcSelectionToken.aggregate({
            _max: { pickMoreFromTick: true },
            where: { pickMoreFromTick: { not: null } },
        }),
    ]);
    const values: Array<[string, bigint | null]> = [
        ['general.turn_tick', general._max.turnTick],
        ['general.meta.next_change_tick', reselection[0]?.maxTick ?? null],
        ['auction.close_tick', auction._max.closeTick],
        ['message_action.expires_game_tick', message._max.expiresGameTick],
        ['vote_poll.end_tick', vote._max.endTick],
        ['select_pool.reserved_until_tick', pool._max.reservedUntilTick],
        ['select_npc_token.valid_until_tick', npcValid._max.validUntilTick],
        ['select_npc_token.pick_more_from_tick', npcMore._max.pickMoreFromTick],
    ];
    for (const [label, value] of values) {
        if (value !== null && value > maximum) {
            throw new Error(`${label} would exceed the safe game tick range after reconciliation.`);
        }
    }
};

const applyParticipantShift = async (
    db: GamePrisma.TransactionClient,
    worldStateId: number,
    cutTick: bigint,
    alignedTick: bigint,
    targetRevision: bigint,
    targetGeneration: bigint,
    shiftTicks: bigint,
    projectionDeltaMilliseconds: number,
    resumeWallAt: Date
): Promise<Map<string, number>> => {
    const affected = new Map<string, number>();
    const world = await db.worldState.findUniqueOrThrow({ where: { id: worldStateId }, select: { meta: true } });
    const cursor = await db.worldState.updateMany({
        where: { id: worldStateId, lastTurnTick: { not: null } },
        data: { lastTurnTick: { increment: shiftTicks } },
    });
    affected.set('turn-cursor', cursor.count);
    affected.set(
        'general-next-turn',
        await db.$executeRaw(GamePrisma.sql`
            UPDATE general
            SET turn_tick = turn_tick + ${shiftTicks},
                turn_time = turn_time + ${projectionDeltaMilliseconds} * INTERVAL '1 millisecond'
            WHERE turn_tick IS NOT NULL
        `)
    );
    affected.set(
        'selection-reselection-deadline',
        await db.$executeRaw(GamePrisma.sql`
            UPDATE general
            SET meta = jsonb_set(
                jsonb_set(
                    jsonb_set(
                        meta,
                        '{next_change_tick}',
                        to_jsonb((meta->>'next_change_tick')::bigint + ${shiftTicks}),
                        true
                    ),
                    '{next_change}',
                    to_jsonb(((meta->>'next_change')::timestamp
                        + ${projectionDeltaMilliseconds} * INTERVAL '1 millisecond')::text),
                    true
                ),
                '{nextChangeAt}',
                to_jsonb(((meta->>'nextChangeAt')::timestamp
                    + ${projectionDeltaMilliseconds} * INTERVAL '1 millisecond')::text),
                true
            )
            WHERE meta->>'next_change_tick' ~ '^-?[0-9]+$'
              AND (meta->>'next_change_tick')::bigint >= ${cutTick}
        `)
    );
    affected.set(
        'auction-deadline',
        await db.$executeRaw(GamePrisma.sql`
            UPDATE auction
            SET close_tick = close_tick + ${shiftTicks},
                close_at = close_at + ${projectionDeltaMilliseconds} * INTERVAL '1 millisecond'
            WHERE status IN ('OPEN'::auction_status, 'FINALIZING'::auction_status)
              AND close_tick IS NOT NULL
        `)
    );
    affected.set(
        'message-action-clock-coordinate',
        (
            await db.messageAction.updateMany({
                where: { status: 'PENDING' },
                data: {
                    clockRevision: targetRevision,
                    deadlineGeneration: targetGeneration,
                },
            })
        ).count
    );
    affected.set(
        'message-action-expiry',
        await db.$executeRaw(GamePrisma.sql`
            WITH shifted AS (
                UPDATE message_action
                SET expires_game_tick = expires_game_tick + ${shiftTicks},
                    clock_revision = ${targetRevision},
                    deadline_generation = ${targetGeneration},
                    updated_at_wall = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                WHERE status = 'PENDING'
                  AND expires_game_tick IS NOT NULL
                  AND expires_game_tick >= ${cutTick}
                RETURNING message_id, expires_game_tick
            )
            UPDATE message AS envelope
            SET valid_until_tick = shifted.expires_game_tick,
                valid_until = envelope.valid_until
                    + ${projectionDeltaMilliseconds} * INTERVAL '1 millisecond'
            FROM shifted
            WHERE envelope.id = shifted.message_id
        `)
    );
    affected.set(
        'vote-end-deadline',
        await db.$executeRaw(GamePrisma.sql`
            UPDATE vote_poll
            SET end_tick = end_tick + ${shiftTicks},
                end_at = end_at + ${projectionDeltaMilliseconds} * INTERVAL '1 millisecond'
            WHERE closed_at IS NULL AND end_tick IS NOT NULL
        `)
    );
    affected.set(
        'select-pool-reservation',
        await db.$executeRaw(GamePrisma.sql`
            UPDATE select_pool
            SET reserved_until_tick = reserved_until_tick + ${shiftTicks},
                reserved_until = reserved_until + ${projectionDeltaMilliseconds} * INTERVAL '1 millisecond'
            WHERE general_id IS NULL AND reserved_until_tick IS NOT NULL
        `)
    );
    affected.set(
        'npc-selection-window',
        await db.$executeRaw(GamePrisma.sql`
            UPDATE select_npc_token
            SET valid_until_tick = CASE
                    WHEN valid_until_tick IS NULL THEN NULL ELSE valid_until_tick + ${shiftTicks} END,
                valid_until = CASE
                    WHEN valid_until_tick IS NULL THEN valid_until
                    ELSE valid_until + ${projectionDeltaMilliseconds} * INTERVAL '1 millisecond' END,
                pick_more_from_tick = CASE
                    WHEN pick_more_from_tick IS NULL THEN NULL ELSE pick_more_from_tick + ${shiftTicks} END,
                pick_more_from = CASE
                    WHEN pick_more_from_tick IS NULL THEN pick_more_from
                    ELSE pick_more_from + ${projectionDeltaMilliseconds} * INTERVAL '1 millisecond' END
            WHERE valid_until_tick IS NOT NULL OR pick_more_from_tick IS NOT NULL
        `)
    );
    await db.worldState.update({
        where: { id: worldStateId },
        data: {
            clockTick: alignedTick,
            clockWallAnchor: resumeWallAt,
            clockPhase: 'RECONCILING',
            clockRevision: targetRevision,
            deadlineGeneration: targetGeneration,
            meta: shiftedMeta(world.meta, projectionDeltaMilliseconds),
        },
    });
    affected.set('world-clock', 1);
    affected.set('movable-json-rule-anchors', 1);
    affected.set('auction-finalizing-recovery', 0);
    return affected;
};

export const startClockSuspension = async (options: {
    db: GamePrismaClient;
    suspensionId: string;
    source: ClockSuspensionSource;
    authority: ClockOperationAuthority;
    policy?: ClockAlignmentPolicy;
    catchUpTicks?: number;
}): Promise<ClockSuspensionResult> => {
    if (!options.suspensionId.trim() || options.suspensionId.length > 64) {
        throw new Error('Clock suspension ID must contain 1-64 characters.');
    }
    const policy = options.policy ?? 'EXACT';
    const catchUpTicks = options.catchUpTicks ?? 0;
    if (!Number.isSafeInteger(catchUpTicks) || catchUpTicks < 0) {
        throw new Error('Clock suspension catch-up ticks must be a non-negative safe integer.');
    }
    return runSerializableClockOperation(() =>
        options.db.$transaction(
            async (db) => {
                await verifyAuthority(db, options.authority);
                await acquireGameSchemaAdvisoryXactLock(db, CLOCK_OPERATION_PERSISTENCE_LOCK);
                await acquireGameSchemaAdvisoryXactLock(db, GENERAL_ACCESS_PERSISTENCE_LOCK);
                const worldStateId = await lockWorld(db);
                const existing = await db.clockSuspension.findUnique({ where: { id: options.suspensionId } });
                if (existing) {
                    if (
                        existing.worldStateId !== worldStateId ||
                        existing.source !== options.source ||
                        existing.policy !== policy
                    ) {
                        throw new Error(
                            `Clock suspension ID ${options.suspensionId} is already bound to another operation.`
                        );
                    }
                    if (existing.status !== 'SUSPENDED') {
                        throw new Error(
                            `Clock suspension ${options.suspensionId} already advanced to ${existing.status}.`
                        );
                    }
                    return {
                        suspensionId: existing.id,
                        phase: 'SUSPENDED' as const,
                        sourceRevision: safeNumber(existing.sourceRevision, 'source revision'),
                        targetRevision: safeNumber(existing.targetRevision, 'target revision'),
                        cutTick: safeNumber(existing.cutTick, 'cut tick'),
                        cutWallAt: existing.cutWallAt,
                    };
                }
                const world = await db.worldState.findUniqueOrThrow({ where: { id: worldStateId } });
                const phase = parseGameClockPhase(world.clockPhase);
                if (phase !== 'RUNNING') {
                    throw new Error(`Clock suspension can start only from RUNNING; current phase is ${phase}.`);
                }
                if (!world.clockBaseTime || world.clockTick === null || !world.clockWallAnchor) {
                    throw new Error('Clock suspension requires a fully initialized logical game clock.');
                }
                const cutWallAt = await readDbWall(db);
                const storedTick = safeNumber(world.clockTick, 'world clock tick');
                const sourceRevision = safeNumber(world.clockRevision, 'world clock revision');
                const clock = new GameClock({
                    baseTime: world.clockBaseTime,
                    tick: storedTick,
                    mode: world.clockMode === 'manual' ? 'manual' : 'realtime',
                    wallAnchor: world.clockWallAnchor,
                    turnSeconds: world.tickSeconds,
                    phase,
                    revision: sourceRevision,
                });
                const cutTick = clock.nowTick(cutWallAt);
                await lockParticipants(db, BigInt(cutTick));
                await db.worldState.update({
                    where: { id: worldStateId },
                    data: { clockPhase: 'SUSPENDED', clockTick: BigInt(cutTick), clockWallAnchor: cutWallAt },
                });
                const participants = await readParticipantSnapshots(db, worldStateId, BigInt(cutTick));
                await db.clockSuspension.create({
                    data: {
                        id: options.suspensionId,
                        worldStateId,
                        source: options.source,
                        policy,
                        status: 'SUSPENDED',
                        sourceRevision: BigInt(sourceRevision),
                        targetRevision: BigInt(sourceRevision + 1),
                        cutTick: BigInt(cutTick),
                        cutWallAt,
                        rateTicksPerSecond: GAME_TICKS_PER_TURN / world.tickSeconds,
                        catchUpTicks: BigInt(catchUpTicks),
                        participantChecksumBefore: aggregateChecksum(participants),
                        detail: asJson({
                            authority: options.authority.kind,
                            profileName: options.authority.profileName,
                        }),
                    },
                });
                await persistInitialParticipants(db, options.suspensionId, participants);
                return {
                    suspensionId: options.suspensionId,
                    phase: 'SUSPENDED',
                    sourceRevision,
                    targetRevision: sourceRevision + 1,
                    cutTick,
                    cutWallAt,
                };
            },
            { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 }
        )
    );
};

/**
 * Continues a suspension inside a transaction whose caller already verified
 * daemon authority and acquired the clock/general-access lock prefix.
 */
export const reconcileClockSuspensionInTransaction = async (options: {
    db: GamePrisma.TransactionClient;
    suspensionId: string;
    profileName: string;
    allowUnificationWait?: boolean;
    authority?: ClockOperationAuthority;
    /** Deterministic fixture seam; production must always use PostgreSQL CURRENT_TIMESTAMP. */
    testResumeWallAt?: Date;
}): Promise<ClockReconciliationResult> => {
    const db = options.db;
    const worldStateId = await lockWorld(db);
    const suspension = await db.clockSuspension.findUniqueOrThrow({ where: { id: options.suspensionId } });
    if (suspension.worldStateId !== worldStateId) {
        throw new Error('Clock suspension belongs to another world state.');
    }
    if (suspension.status === 'RECONCILING' || suspension.status === 'APPLIED') {
        if (
            suspension.gapTicks === null ||
            suspension.shiftTicks === null ||
            suspension.alignedTick === null ||
            !suspension.resumeWallAt
        ) {
            throw new Error('Persisted clock reconciliation result is incomplete.');
        }
        const world = await db.worldState.findUniqueOrThrow({ where: { id: worldStateId } });
        return {
            suspensionId: suspension.id,
            phase: 'RECONCILING' as const,
            sourceRevision: safeNumber(suspension.sourceRevision, 'source revision'),
            targetRevision: safeNumber(suspension.targetRevision, 'target revision'),
            deadlineGeneration: safeNumber(world.deadlineGeneration, 'deadline generation'),
            gapTicks: safeNumber(suspension.gapTicks, 'gap ticks'),
            catchUpTicks: safeNumber(suspension.catchUpTicks, 'catch-up ticks'),
            shiftTicks: safeNumber(suspension.shiftTicks, 'shift ticks'),
            alignedTick: safeNumber(suspension.alignedTick, 'aligned tick'),
            resumeWallAt: suspension.resumeWallAt,
        };
    }
    if (suspension.status !== 'SUSPENDED') {
        throw new Error(`Clock suspension cannot reconcile from status ${suspension.status}.`);
    }
    const world = await db.worldState.findUniqueOrThrow({ where: { id: worldStateId } });
    const phase = parseGameClockPhase(world.clockPhase);
    if (phase !== 'SUSPENDED' || world.clockRevision !== suspension.sourceRevision) {
        throw new Error('Clock reconciliation phase or source revision fence failed.');
    }
    const worldMeta =
        world.meta && typeof world.meta === 'object' && !Array.isArray(world.meta)
            ? (world.meta as Record<string, unknown>)
            : {};
    const united = Number(worldMeta.isunited ?? worldMeta.isUnited ?? 0);
    if (suspension.source === 'UNIFICATION_WAIT' || united >= 2) {
        if (!options.allowUnificationWait || options.authority?.kind !== 'DAEMON') {
            throw new Error('Unification wait requires the daemon-authorized atomic alignment-and-invader workflow.');
        }
        await verifyAuthority(db, options.authority);
    }
    const cutTick = safeNumber(suspension.cutTick, 'cut tick');
    await lockParticipants(db, suspension.cutTick);
    if (options.testResumeWallAt && process.env.NODE_ENV !== 'test') {
        throw new Error('A clock reconciliation wall override is allowed only in tests.');
    }
    const resumeWallAt = options.testResumeWallAt ? new Date(options.testResumeWallAt.getTime()) : await readDbWall(db);
    const plan = buildClockAlignmentPlan({
        policy: parseClockAlignmentPolicy(suspension.policy),
        sourceRevision: safeNumber(suspension.sourceRevision, 'source revision'),
        cutTick,
        cutWall: suspension.cutWallAt,
        resumeWall: resumeWallAt,
        ticksPerSecond: suspension.rateTicksPerSecond,
        catchUpTicks: safeNumber(suspension.catchUpTicks, 'catch-up ticks'),
    });
    const before = await readParticipantSnapshots(db, worldStateId, suspension.cutTick);
    assertShiftFits(before, plan.shiftTicks);
    await assertScheduleRanges(db, plan.shiftTicks);
    const projectionDeltaMilliseconds = Math.trunc((plan.shiftTicks * 1_000) / suspension.rateTicksPerSecond);
    if (!Number.isSafeInteger(projectionDeltaMilliseconds)) {
        throw new Error('Clock reconciliation projection delta is outside the safe integer range.');
    }
    const targetGeneration = world.deadlineGeneration + 1n;
    const affected = await applyParticipantShift(
        db,
        worldStateId,
        suspension.cutTick,
        BigInt(plan.alignedTick),
        BigInt(plan.targetRevision),
        targetGeneration,
        BigInt(plan.shiftTicks),
        projectionDeltaMilliseconds,
        resumeWallAt
    );
    const after = await readParticipantSnapshots(db, worldStateId, suspension.cutTick);
    const afterByKey = new Map(after.map((participant) => [participant.key, participant]));
    for (const participant of before) {
        const next = afterByKey.get(participant.key);
        if (!next) throw new Error(`Missing post-reconciliation participant: ${participant.key}`);
        if (participant.policy === 'KEEP' && participant.checksum !== next.checksum) {
            throw new Error(`KEEP participant changed during reconciliation: ${participant.key}`);
        }
        await db.clockReconciliationParticipant.upsert({
            where: {
                suspensionId_participantKey: {
                    suspensionId: suspension.id,
                    participantKey: participant.key,
                },
            },
            create: {
                suspensionId: suspension.id,
                participantKey: participant.key,
                policy: participant.policy,
                beforeChecksum: participant.checksum,
                afterChecksum: next.checksum,
                affectedCount: affected.get(participant.key) ?? 0,
            },
            update: {
                policy: participant.policy,
                beforeChecksum: participant.checksum,
                afterChecksum: next.checksum,
                affectedCount: affected.get(participant.key) ?? 0,
            },
        });
    }
    const outboxPayload = {
        version: 1,
        profileName: options.profileName,
        suspensionId: suspension.id,
        sourceRevision: plan.sourceRevision,
        targetRevision: plan.targetRevision,
        deadlineGeneration: safeNumber(targetGeneration, 'deadline generation'),
        shiftTicks: plan.shiftTicks,
        projectionDeltaMilliseconds,
        clockBaseTime: world.clockBaseTime!.toISOString(),
        ticksPerSecond: suspension.rateTicksPerSecond,
    };
    await db.clockProjectionOutbox.create({
        data: {
            worldStateId,
            suspensionId: suspension.id,
            targetRevision: BigInt(plan.targetRevision),
            status: 'PENDING',
            payload: asJson(outboxPayload),
            checksum: checksum(outboxPayload),
        },
    });
    await db.clockSuspension.update({
        where: { id: suspension.id },
        data: {
            status: 'RECONCILING',
            resumeWallAt,
            gapTicks: BigInt(plan.gapTicks),
            shiftTicks: BigInt(plan.shiftTicks),
            alignedTick: BigInt(plan.alignedTick),
            participantChecksumBefore: aggregateChecksum(before),
            participantChecksumAfter: aggregateChecksum(after),
        },
    });
    return {
        suspensionId: suspension.id,
        phase: 'RECONCILING',
        sourceRevision: plan.sourceRevision,
        targetRevision: plan.targetRevision,
        deadlineGeneration: safeNumber(targetGeneration, 'deadline generation'),
        gapTicks: plan.gapTicks,
        catchUpTicks: plan.catchUpTicks,
        shiftTicks: plan.shiftTicks,
        alignedTick: plan.alignedTick,
        resumeWallAt,
    };
};

/** Finalizes an atomic unification workflow after an optional rate change. */
export const refreshClockProjectionForFinalClockUnderHeldLocks = async (options: {
    db: GamePrisma.TransactionClient;
    suspensionId: string;
    clockBaseTime: Date;
    tickSeconds: number;
}): Promise<void> => {
    if (GAME_TICKS_PER_TURN % options.tickSeconds !== 0) {
        throw new Error(`Final clock rate cannot represent an integer tick: ${options.tickSeconds}.`);
    }
    const outbox = await options.db.clockProjectionOutbox.findFirstOrThrow({
        where: { suspensionId: options.suspensionId, status: 'PENDING' },
        orderBy: { id: 'asc' },
    });
    const payload =
        outbox.payload && typeof outbox.payload === 'object' && !Array.isArray(outbox.payload)
            ? { ...(outbox.payload as Record<string, unknown>) }
            : null;
    if (!payload || payload.suspensionId !== options.suspensionId) {
        throw new Error('Unification clock projection outbox payload is invalid.');
    }
    payload.clockBaseTime = options.clockBaseTime.toISOString();
    payload.ticksPerSecond = GAME_TICKS_PER_TURN / options.tickSeconds;
    await options.db.clockProjectionOutbox.update({
        where: { id: outbox.id },
        data: { payload: asJson(payload), checksum: checksum(payload) },
    });
};

export const reconcileClockSuspension = async (options: {
    db: GamePrismaClient;
    suspensionId: string;
    authority: ClockOperationAuthority;
    /** Deterministic fixture seam; production must always use PostgreSQL CURRENT_TIMESTAMP. */
    testResumeWallAt?: Date;
}): Promise<ClockReconciliationResult> =>
    runSerializableClockOperation(() =>
        options.db.$transaction(
            async (db) => {
                await verifyAuthority(db, options.authority);
                await acquireGameSchemaAdvisoryXactLock(db, CLOCK_OPERATION_PERSISTENCE_LOCK);
                await acquireGameSchemaAdvisoryXactLock(db, GENERAL_ACCESS_PERSISTENCE_LOCK);
                return reconcileClockSuspensionInTransaction({
                    db,
                    suspensionId: options.suspensionId,
                    profileName: options.authority.profileName,
                    authority: options.authority,
                    ...(options.testResumeWallAt ? { testResumeWallAt: options.testResumeWallAt } : {}),
                });
            },
            { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 }
        )
    );
