import { createHash, randomUUID } from 'node:crypto';

import { asRecord, resolveAccessLimitLevel, resolveAccessRefreshLimit } from '@sammo-ts/common';
import { GamePrisma } from '@sammo-ts/infra';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';

import type { DatabaseClient } from '../context.js';
import type { ProfileStatusSource } from '../auth/profileStatusSource.js';
import { resolveAccessWindows } from './generalAccess.js';

export const DEFERRED_GENERAL_ACCESS_FLUSH_INTERVAL_MS = 5_000;
const ACTIVE_BATCH_TTL_MS = 24 * 60 * 60 * 1_000;
const COMPLETED_BATCH_RETENTION_DAYS = 7;

const adminRoles = new Set(['superuser', 'admin', 'admin.superuser']);

interface DeferredAccessRedis {
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
    scanIterator(options: { MATCH: string; COUNT: number }): AsyncGenerator<string[], void>;
    hGetAll(key: string): Promise<Record<string, string>>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options: { PX: number }): Promise<string | null>;
    del(key: string): Promise<number>;
}

export type DeferredGeneralAccessEntry = {
    generalId: number;
    userId: string;
    weight: number;
    lastRefresh: Date;
};

export type DeferredGeneralAccessLimit = {
    nextAccessAt: Date;
};

type DeferredGeneralAccessFlushRow = {
    generalId: number;
    userId: string;
    refreshScore: number;
    nextAccessAt: Date;
};

const ENQUEUE_SCRIPT = `
local weight_field = 'weight:' .. ARGV[1]
local user_field = 'user:' .. ARGV[1]
local time_field = 'time:' .. ARGV[1]
local next_weight = redis.call('HINCRBY', KEYS[1], weight_field, ARGV[3])
redis.call('HSET', KEYS[1], user_field, ARGV[2])
local current_time = redis.call('HGET', KEYS[1], time_field)
if not current_time or tonumber(ARGV[4]) > tonumber(current_time) then
    redis.call('HSET', KEYS[1], time_field, ARGV[4])
end
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return next_weight
`;

const ROTATE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
    return 0
end
if redis.call('EXISTS', KEYS[2]) == 1 then
    return -1
end
redis.call('RENAME', KEYS[1], KEYS[2])
return 1
`;

const activeKey = (profileName: string): string => `sammo:game:general-access:pending:${profileName}`;
const batchPrefix = (profileName: string): string => `sammo:game:general-access:batch:${profileName}:`;
const batchKey = (profileName: string, batchId: string): string => `${batchPrefix(profileName)}${batchId}`;
const limitKey = (profileName: string, userId: string): string =>
    `sammo:game:general-access:limited:${profileName}:${createHash('sha256').update(userId).digest('base64url')}`;

const isEligibleUser = (auth: GameSessionTokenPayload | null): auth is GameSessionTokenPayload =>
    Boolean(auth && !auth.user.roles.some((role) => adminRoles.has(role)));

export const enqueueDeferredGeneralAccess = async (
    redis: Pick<DeferredAccessRedis, 'eval'>,
    profileName: string,
    auth: GameSessionTokenPayload | null,
    generalId: number,
    weight: number,
    now = new Date()
): Promise<boolean> => {
    if (!Number.isSafeInteger(generalId) || generalId <= 0) {
        return false;
    }
    if (!Number.isInteger(weight) || weight < 0) {
        throw new RangeError('Deferred general access weight must be a non-negative integer.');
    }
    if (!isEligibleUser(auth)) {
        return false;
    }
    await redis.eval(ENQUEUE_SCRIPT, {
        keys: [activeKey(profileName)],
        arguments: [String(generalId), auth.user.id, String(weight), String(now.getTime()), String(ACTIVE_BATCH_TTL_MS)],
    });
    return true;
};

export const getDeferredGeneralAccessLimit = async (
    redis: Pick<DeferredAccessRedis, 'get'>,
    profileName: string,
    auth: GameSessionTokenPayload | null,
    now = new Date()
): Promise<DeferredGeneralAccessLimit | null> => {
    if (!isEligibleUser(auth)) {
        return null;
    }
    const raw = await redis.get(limitKey(profileName, auth.user.id));
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as { nextAccessAt?: unknown };
        if (typeof parsed.nextAccessAt !== 'string') {
            return null;
        }
        const nextAccessAt = new Date(parsed.nextAccessAt);
        if (Number.isNaN(nextAccessAt.getTime()) || nextAccessAt.getTime() <= now.getTime()) {
            return null;
        }
        return { nextAccessAt };
    } catch {
        return null;
    }
};

const parseBatchHash = (values: Record<string, string>): DeferredGeneralAccessEntry[] => {
    const result: DeferredGeneralAccessEntry[] = [];
    for (const [field, rawWeight] of Object.entries(values)) {
        if (!field.startsWith('weight:')) continue;
        const idText = field.slice('weight:'.length);
        const generalId = Number(idText);
        const weight = Number(rawWeight);
        const userId = values[`user:${idText}`];
        const timestamp = Number(values[`time:${idText}`]);
        if (
            !Number.isSafeInteger(generalId) ||
            generalId <= 0 ||
            !Number.isSafeInteger(weight) ||
            weight < 0 ||
            !userId ||
            !Number.isSafeInteger(timestamp)
        ) {
            continue;
        }
        const lastRefresh = new Date(timestamp);
        if (!Number.isNaN(lastRefresh.getTime())) {
            result.push({ generalId, userId, weight, lastRefresh });
        }
    }
    return result.sort((left, right) => left.generalId - right.generalId);
};

const markBatchProcessed = async (db: Pick<DatabaseClient, '$executeRaw'>, batchId: string): Promise<void> => {
    await db.$executeRaw(GamePrisma.sql`
        INSERT INTO "general_access_batch" ("id")
        VALUES (${batchId})
        ON CONFLICT ("id") DO NOTHING
    `);
};

export const flushDeferredGeneralAccessBatch = async (
    db: Pick<DatabaseClient, '$queryRaw' | '$executeRaw' | 'worldState'>,
    batchId: string,
    entries: readonly DeferredGeneralAccessEntry[]
): Promise<{ states: DeferredGeneralAccessFlushRow[]; refreshLimit: number }> => {
    if (entries.length === 0) {
        await markBatchProcessed(db, batchId);
        return { states: [], refreshLimit: 0 };
    }
    const worldState = await db.worldState.findFirst({
        orderBy: { id: 'asc' },
        select: {
            id: true,
            currentYear: true,
            currentMonth: true,
            tickSeconds: true,
            meta: true,
        },
    });
    if (!worldState) {
        throw new Error('Deferred general access flush requires a world state.');
    }

    const meta = asRecord(worldState.meta);
    const isUnited = Number(meta.isUnited ?? meta.isunited ?? 0);
    const openTime = typeof meta.opentime === 'string' ? new Date(meta.opentime) : null;
    const newestRefresh = entries.reduce(
        (latest, entry) => (entry.lastRefresh.getTime() > latest.getTime() ? entry.lastRefresh : latest),
        entries[0]!.lastRefresh
    );
    if (isUnited === 2 || (openTime && !Number.isNaN(openTime.getTime()) && openTime > newestRefresh)) {
        await markBatchProcessed(db, batchId);
        return {
            states: [],
            refreshLimit: resolveAccessRefreshLimit(worldState.tickSeconds, meta.refreshLimit),
        };
    }

    const { periodStartedAt } = resolveAccessWindows(newestRefresh, worldState.tickSeconds, meta);
    const payload = JSON.stringify(
        entries.map(({ generalId, userId, weight, lastRefresh }) => ({
            generalId,
            userId,
            weight,
            lastRefresh: lastRefresh.toISOString(),
        }))
    );
    const periodKey = worldState.currentYear * 12 + worldState.currentMonth - 1;
    const states = await db.$queryRaw<DeferredGeneralAccessFlushRow[]>(GamePrisma.sql`
        WITH inserted_batch AS (
            INSERT INTO "general_access_batch" ("id")
            VALUES (${batchId})
            ON CONFLICT ("id") DO NOTHING
            RETURNING "id"
        ),
        input AS (
            SELECT
                value."generalId" AS "general_id",
                value."userId" AS "user_id",
                value."weight",
                value."lastRefresh" AS "last_refresh"
            FROM jsonb_to_recordset(CAST(${payload} AS jsonb)) AS value(
                "generalId" INTEGER,
                "userId" TEXT,
                "weight" INTEGER,
                "lastRefresh" TIMESTAMPTZ
            )
        ),
        resolved AS (
            SELECT
                input."general_id",
                input."user_id",
                input."weight",
                input."last_refresh",
                actor."turn_time"
            FROM input
            JOIN "general" AS actor
              ON actor."id" = input."general_id"
             AND actor."user_id" = input."user_id"
            WHERE EXISTS (SELECT 1 FROM inserted_batch)
              AND input."weight" >= 0
        ),
        latest_period AS (
            SELECT MAX("year" * 12 + "month" - 1)::INTEGER AS "period_key"
            FROM "traffic_period"
            WHERE "world_state_id" = ${worldState.id}
        ),
        missing_periods AS (
            INSERT INTO "traffic_period" (
                "world_state_id", "year", "month", "started_at", "last_refresh", "refresh", "online"
            )
            SELECT
                ${worldState.id},
                (missing_key / 12)::INTEGER,
                (missing_key % 12 + 1)::INTEGER,
                CAST(${periodStartedAt} AS TIMESTAMP) - (
                    (${periodKey} - missing_key) * ${worldState.tickSeconds}
                ) * INTERVAL '1 second',
                CAST(${periodStartedAt} AS TIMESTAMP) - (
                    (${periodKey} - missing_key - 1) * ${worldState.tickSeconds}
                ) * INTERVAL '1 second',
                0,
                0
            FROM latest_period
            CROSS JOIN LATERAL generate_series(latest_period."period_key" + 1, ${periodKey} - 1) AS missing_key
            WHERE latest_period."period_key" IS NOT NULL
              AND EXISTS (SELECT 1 FROM resolved)
            ON CONFLICT ("world_state_id", "year", "month") DO NOTHING
            RETURNING "id"
        ),
        period_upsert AS (
            INSERT INTO "traffic_period" (
                "world_state_id", "year", "month", "started_at", "last_refresh", "refresh", "online"
            )
            SELECT
                ${worldState.id},
                ${worldState.currentYear},
                ${worldState.currentMonth},
                ${periodStartedAt},
                MAX(resolved."last_refresh"),
                SUM(resolved."weight")::INTEGER,
                COUNT(*)::INTEGER
            FROM resolved
            HAVING COUNT(*) > 0
            ON CONFLICT ("world_state_id", "year", "month") DO UPDATE SET
                "started_at" = LEAST("traffic_period"."started_at", EXCLUDED."started_at"),
                "last_refresh" = GREATEST("traffic_period"."last_refresh", EXCLUDED."last_refresh"),
                "refresh" = "traffic_period"."refresh" + EXCLUDED."refresh",
                "online" = "traffic_period"."online" + (
                    SELECT COUNT(*)::INTEGER
                    FROM resolved
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM "traffic_period_general" AS existing_member
                        WHERE existing_member."period_id" = "traffic_period"."id"
                          AND existing_member."general_id" = resolved."general_id"
                    )
                )
            RETURNING "id"
        ),
        inserted_generals AS (
            INSERT INTO "traffic_period_general" (
                "period_id", "general_id", "user_id", "refresh", "last_refresh"
            )
            SELECT
                period_upsert."id",
                resolved."general_id",
                resolved."user_id",
                resolved."weight",
                resolved."last_refresh"
            FROM resolved
            CROSS JOIN period_upsert
            ON CONFLICT ("period_id", "general_id") DO NOTHING
            RETURNING "period_id", "general_id"
        ),
        updated_generals AS (
            UPDATE "traffic_period_general" AS existing
            SET
                "user_id" = resolved."user_id",
                "refresh" = existing."refresh" + resolved."weight",
                "last_refresh" = GREATEST(existing."last_refresh", resolved."last_refresh")
            FROM resolved
            CROSS JOIN period_upsert
            WHERE existing."period_id" = period_upsert."id"
              AND existing."general_id" = resolved."general_id"
              AND NOT EXISTS (
                  SELECT 1 FROM inserted_generals
                  WHERE inserted_generals."period_id" = existing."period_id"
                    AND inserted_generals."general_id" = existing."general_id"
              )
            RETURNING existing."general_id"
        ),
        access_updates AS (
            INSERT INTO "general_access_log" (
                "general_id", "user_id", "last_refresh", "refresh", "refresh_total",
                "refresh_score", "refresh_score_total"
            )
            SELECT
                resolved."general_id",
                resolved."user_id",
                resolved."last_refresh",
                resolved."weight",
                resolved."weight",
                CASE
                    WHEN resolved."last_refresh" >= resolved."turn_time" - (
                        ${worldState.tickSeconds} * INTERVAL '1 second'
                    ) THEN resolved."weight"
                    ELSE 0
                END,
                resolved."weight"
            FROM resolved
            ON CONFLICT ("general_id") DO UPDATE SET
                "user_id" = EXCLUDED."user_id",
                "last_refresh" = GREATEST("general_access_log"."last_refresh", EXCLUDED."last_refresh"),
                "refresh" = CASE
                    WHEN "general_access_log"."last_refresh" IS NULL
                      OR "general_access_log"."last_refresh" < ${periodStartedAt}
                    THEN EXCLUDED."refresh"
                    ELSE "general_access_log"."refresh" + EXCLUDED."refresh"
                END,
                "refresh_total" = "general_access_log"."refresh_total" + EXCLUDED."refresh_total",
                "refresh_score" = CASE
                    WHEN "general_access_log"."last_refresh" IS NULL
                      OR "general_access_log"."last_refresh" < (
                          SELECT resolved."turn_time" - (${worldState.tickSeconds} * INTERVAL '1 second')
                          FROM resolved
                          WHERE resolved."general_id" = EXCLUDED."general_id"
                      )
                    THEN EXCLUDED."refresh_score"
                    ELSE "general_access_log"."refresh_score" + EXCLUDED."refresh_score"
                END,
                "refresh_score_total" =
                    "general_access_log"."refresh_score_total" + EXCLUDED."refresh_score_total"
            RETURNING "general_id", "user_id", "refresh_score"
        ),
        pruned_batches AS (
            DELETE FROM "general_access_batch"
            WHERE "created_at" < CURRENT_TIMESTAMP - (${COMPLETED_BATCH_RETENTION_DAYS} * INTERVAL '1 day')
            RETURNING "id"
        )
        SELECT
            actor."id" AS "generalId",
            input."user_id" AS "userId",
            COALESCE(access_updates."refresh_score", access_log."refresh_score", 0) AS "refreshScore",
            actor."turn_time" AS "nextAccessAt"
        FROM input
        JOIN "general" AS actor
          ON actor."id" = input."general_id"
         AND actor."user_id" = input."user_id"
        LEFT JOIN access_updates ON access_updates."general_id" = actor."id"
        LEFT JOIN "general_access_log" AS access_log ON access_log."general_id" = actor."id"
        ORDER BY actor."id"
    `);
    return {
        states,
        refreshLimit: resolveAccessRefreshLimit(worldState.tickSeconds, meta.refreshLimit),
    };
};

export interface DeferredGeneralAccessWorkerOptions {
    intervalMs?: number;
    now?: () => Date;
    createBatchId?: () => string;
    onError?: (error: unknown) => void;
}

export class DeferredGeneralAccessWorker {
    private timer: NodeJS.Timeout | null = null;
    private inFlight: Promise<void> | null = null;
    private running = false;
    private readonly intervalMs: number;
    private readonly now: () => Date;
    private readonly createBatchId: () => string;
    private readonly onError: (error: unknown) => void;

    constructor(
        private readonly db: Pick<DatabaseClient, '$queryRaw' | '$executeRaw' | 'worldState'>,
        private readonly redis: DeferredAccessRedis,
        private readonly profileName: string,
        private readonly profileStatusSource: ProfileStatusSource,
        options: DeferredGeneralAccessWorkerOptions = {}
    ) {
        this.intervalMs = Math.max(1, Math.floor(options.intervalMs ?? DEFERRED_GENERAL_ACCESS_FLUSH_INTERVAL_MS));
        this.now = options.now ?? (() => new Date());
        this.createBatchId = options.createBatchId ?? randomUUID;
        this.onError = options.onError ?? (() => undefined);
    }

    private async listBatchKeys(): Promise<string[]> {
        const keys = new Set<string>();
        for await (const page of this.redis.scanIterator({ MATCH: `${batchPrefix(this.profileName)}*`, COUNT: 100 })) {
            for (const key of page) keys.add(key);
        }
        const batchId = this.createBatchId();
        const rotatedKey = batchKey(this.profileName, batchId);
        const rotated = Number(
            await this.redis.eval(ROTATE_SCRIPT, {
                keys: [activeKey(this.profileName), rotatedKey],
                arguments: [],
            })
        );
        if (rotated === 1) keys.add(rotatedKey);
        return [...keys].sort();
    }

    private async applyLimitStates(
        states: readonly DeferredGeneralAccessFlushRow[],
        refreshLimit: number
    ): Promise<void> {
        const now = this.now();
        await Promise.all(
            states.map(async (state) => {
                const key = limitKey(this.profileName, state.userId);
                if (
                    resolveAccessLimitLevel(state.refreshScore, refreshLimit) !== 2 ||
                    state.nextAccessAt.getTime() <= now.getTime()
                ) {
                    await this.redis.del(key);
                    return;
                }
                await this.redis.set(
                    key,
                    JSON.stringify({ nextAccessAt: state.nextAccessAt.toISOString() }),
                    { PX: Math.max(1, state.nextAccessAt.getTime() - now.getTime()) }
                );
            })
        );
    }

    private async processBatch(key: string, runningProfile: boolean): Promise<void> {
        if (!runningProfile) {
            await this.redis.del(key);
            return;
        }
        const values = await this.redis.hGetAll(key);
        const entries = parseBatchHash(values);
        const id = key.slice(batchPrefix(this.profileName).length);
        if (!id) {
            return;
        }
        const result = await flushDeferredGeneralAccessBatch(this.db, id, entries);
        await this.applyLimitStates(result.states, result.refreshLimit);
        await this.redis.del(key);
    }

    private async runOnce(): Promise<void> {
        const keys = await this.listBatchKeys();
        if (keys.length === 0) return;
        let runningProfile = false;
        try {
            runningProfile = (await this.profileStatusSource.get(this.profileName)) === 'RUNNING';
        } catch {
            // Preserve the synchronous fail-open contract: if Gateway status
            // cannot be established, do not retain a batch that may penalize
            // the user after the status service recovers.
        }
        for (const key of keys) {
            await this.processBatch(key, runningProfile);
        }
    }

    async flushOnce(): Promise<void> {
        if (this.inFlight) {
            await this.inFlight;
            return;
        }
        this.inFlight = this.runOnce().finally(() => {
            this.inFlight = null;
        });
        await this.inFlight;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.timer = setInterval(() => {
            void this.flushOnce().catch(this.onError);
        }, this.intervalMs);
        this.timer.unref?.();
        void this.flushOnce().catch(this.onError);
    }

    async stop(): Promise<void> {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        await this.inFlight;
    }
}
