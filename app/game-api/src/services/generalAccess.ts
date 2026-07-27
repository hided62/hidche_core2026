import { asRecord } from '@sammo-ts/common';
import { GamePrisma } from '@sammo-ts/infra';

import type { GameApiContext } from '../context.js';

export const accessPages = [
    'front-info',
    'nation-info',
    'nation-cities',
    'global-info',
    'nation-list',
    'general-list',
    'current-city',
    'diplomacy',
    'nation-generals',
    'nation-personnel',
    'nation-finance',
    'battle-center',
    'board',
    'best-general',
    'hall-of-fame',
    'dynasty',
    'yearbook',
    'nation-betting',
    'traffic',
    'npc-list',
    'my-page',
    'npc-control',
    'tournament',
    'betting',
] as const;

export type AccessPage = (typeof accessPages)[number];

export const accessPageWeights: Record<AccessPage, number> = {
    'front-info': 1,
    'nation-info': 1,
    'nation-cities': 1,
    'global-info': 1,
    'nation-list': 2,
    'general-list': 2,
    'current-city': 1,
    diplomacy: 1,
    'nation-generals': 1,
    'nation-personnel': 1,
    'nation-finance': 1,
    'battle-center': 1,
    board: 1,
    'best-general': 1,
    'hall-of-fame': 1,
    dynasty: 1,
    yearbook: 1,
    'nation-betting': 1,
    traffic: 1,
    'npc-list': 2,
    'my-page': 1,
    'npc-control': 1,
    tournament: 1,
    betting: 1,
};

const adminRoles = new Set(['superuser', 'admin', 'admin.superuser']);

const readFiniteNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const readDate = (value: unknown): Date | null => {
    if (typeof value !== 'string' && !(value instanceof Date)) {
        return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const resolveAccessWindows = (
    now: Date,
    tickSeconds: number,
    worldMeta: unknown
): { periodStartedAt: Date; scoreStartedAt: Date } => {
    const meta = asRecord(worldMeta);
    const tickStartedAt = readDate(meta.lastTurnTime) ?? readDate(meta.turntime);
    const fallbackTickMs = Math.max(1, Math.floor(tickSeconds)) * 1_000;
    const scoreStartedAt =
        tickStartedAt && tickStartedAt.getTime() <= now.getTime()
            ? tickStartedAt
            : new Date(now.getTime() - fallbackTickMs);
    return { periodStartedAt: scoreStartedAt, scoreStartedAt };
};

export const upsertGeneralAccess = async (
    db: Pick<GameApiContext['db'], '$transaction'>,
    input: {
        worldStateId: number;
        year: number;
        month: number;
        tickSeconds: number;
        generalId: number;
        userId: string;
        weight: number;
        now: Date;
        periodStartedAt: Date;
        scoreStartedAt: Date;
    }
): Promise<void> => {
    if (!db.$transaction) {
        throw new Error('Traffic access persistence requires transaction support.');
    }
    await db.$transaction(async (transaction) => {
        const periodKey = input.year * 12 + input.month - 1;
        const periodRows = await transaction.$queryRaw<Array<{ id: number }>>(
            GamePrisma.sql`
                WITH latest_period AS (
                    SELECT MAX(year * 12 + month - 1)::INTEGER AS period_key
                    FROM traffic_period
                    WHERE world_state_id = ${input.worldStateId}
                ),
                missing_periods AS (
                    INSERT INTO traffic_period (
                        world_state_id,
                        year,
                        month,
                        started_at,
                        last_refresh,
                        refresh,
                        online
                    )
                    SELECT
                        ${input.worldStateId},
                        (missing_key / 12)::INTEGER,
                        (missing_key % 12 + 1)::INTEGER,
                        CAST(${input.periodStartedAt} AS TIMESTAMP) - (
                            (${periodKey} - missing_key) * ${input.tickSeconds}
                        ) * INTERVAL '1 second',
                        CAST(${input.periodStartedAt} AS TIMESTAMP) - (
                            (${periodKey} - missing_key - 1) * ${input.tickSeconds}
                        ) * INTERVAL '1 second',
                        0,
                        0
                    FROM latest_period
                    CROSS JOIN LATERAL generate_series(
                        latest_period.period_key + 1,
                        ${periodKey} - 1
                    ) AS missing_key
                    WHERE latest_period.period_key IS NOT NULL
                    ON CONFLICT (world_state_id, year, month) DO NOTHING
                    RETURNING id
                )
                INSERT INTO traffic_period (
                    world_state_id,
                    year,
                    month,
                    started_at,
                    last_refresh,
                    refresh
                )
                VALUES (
                    ${input.worldStateId},
                    ${input.year},
                    ${input.month},
                    ${input.periodStartedAt},
                    ${input.now},
                    ${input.weight}
                )
                ON CONFLICT (world_state_id, year, month) DO UPDATE SET
                    started_at = LEAST(traffic_period.started_at, EXCLUDED.started_at),
                    last_refresh = GREATEST(traffic_period.last_refresh, EXCLUDED.last_refresh),
                    refresh = traffic_period.refresh + EXCLUDED.refresh
                RETURNING id
            `
        );
        const periodId = periodRows[0]?.id;
        if (periodId === undefined) {
            throw new Error('Failed to resolve the traffic period.');
        }

        await transaction.$executeRaw(
            GamePrisma.sql`
                WITH inserted_general AS (
                    INSERT INTO traffic_period_general (
                        period_id,
                        general_id,
                        user_id,
                        refresh,
                        last_refresh
                    )
                    VALUES (
                        ${periodId},
                        ${input.generalId},
                        ${input.userId},
                        ${input.weight},
                        ${input.now}
                    )
                    ON CONFLICT (period_id, general_id) DO NOTHING
                    RETURNING period_id
                ),
                updated_general AS (
                    UPDATE traffic_period_general
                    SET
                        user_id = ${input.userId},
                        refresh = traffic_period_general.refresh + ${input.weight},
                        last_refresh = GREATEST(
                            traffic_period_general.last_refresh,
                            ${input.now}
                        )
                    WHERE period_id = ${periodId}
                      AND general_id = ${input.generalId}
                      AND NOT EXISTS (SELECT 1 FROM inserted_general)
                    RETURNING period_id
                )
                UPDATE traffic_period
                SET online = traffic_period.online + (
                    SELECT COUNT(*)::INTEGER FROM inserted_general
                )
                WHERE id = ${periodId}
            `
        );

        await transaction.$executeRaw(
            GamePrisma.sql`
                INSERT INTO general_access_log (
                    general_id,
                    user_id,
                    last_refresh,
                    refresh,
                    refresh_total,
                    refresh_score,
                    refresh_score_total
                )
                VALUES (
                    ${input.generalId},
                    ${input.userId},
                    ${input.now},
                    ${input.weight},
                    ${input.weight},
                    ${input.weight},
                    ${input.weight}
                )
                ON CONFLICT (general_id) DO UPDATE SET
                    user_id = EXCLUDED.user_id,
                    last_refresh = EXCLUDED.last_refresh,
                    refresh = CASE
                        WHEN general_access_log.last_refresh IS NULL
                            OR general_access_log.last_refresh < ${input.periodStartedAt}
                        THEN EXCLUDED.refresh
                        ELSE general_access_log.refresh + EXCLUDED.refresh
                    END,
                    refresh_total = general_access_log.refresh_total + EXCLUDED.refresh_total,
                    refresh_score = CASE
                        WHEN general_access_log.last_refresh IS NULL
                            OR general_access_log.last_refresh < ${input.scoreStartedAt}
                        THEN EXCLUDED.refresh_score
                        ELSE general_access_log.refresh_score + EXCLUDED.refresh_score
                    END,
                    refresh_score_total =
                        general_access_log.refresh_score_total + EXCLUDED.refresh_score_total
            `
        );
    });
};

export const recordGeneralAccess = async (
    ctx: Pick<GameApiContext, 'auth' | 'db'>,
    page: AccessPage,
    now = new Date()
): Promise<boolean> => {
    const user = ctx.auth?.user;
    if (!user || user.roles.some((role) => adminRoles.has(role))) {
        return false;
    }

    const [general, worldState] = await Promise.all([
        ctx.db.general.findFirst({
            where: { userId: user.id },
            orderBy: { id: 'asc' },
            select: { id: true, userId: true },
        }),
        ctx.db.worldState.findFirst({
            orderBy: { id: 'asc' },
            select: {
                id: true,
                currentYear: true,
                currentMonth: true,
                tickSeconds: true,
                meta: true,
            },
        }),
    ]);
    if (!general || !worldState) {
        return false;
    }

    const meta = asRecord(worldState.meta);
    const isUnited = readFiniteNumber(meta.isUnited) ?? readFiniteNumber(meta.isunited) ?? 0;
    const openTime = readDate(meta.opentime);
    if (isUnited === 2 || (openTime && openTime.getTime() > now.getTime())) {
        return false;
    }

    const weight = accessPageWeights[page];
    const { periodStartedAt, scoreStartedAt } = resolveAccessWindows(now, worldState.tickSeconds, meta);

    await upsertGeneralAccess(ctx.db, {
        worldStateId: worldState.id,
        year: worldState.currentYear,
        month: worldState.currentMonth,
        tickSeconds: worldState.tickSeconds,
        generalId: general.id,
        userId: user.id,
        weight,
        now,
        periodStartedAt,
        scoreStartedAt,
    });
    return true;
};
