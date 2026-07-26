import { asRecord } from '@sammo-ts/common';
import { GamePrisma } from '@sammo-ts/infra';

import type { GameApiContext } from '../context.js';

export const accessPages = [
    'front-info',
    'nation-info',
    'nation-cities',
    'global-info',
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
): { dayStartedAt: Date; scoreStartedAt: Date } => {
    const dayStartedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const meta = asRecord(worldMeta);
    const tickStartedAt = readDate(meta.lastTurnTime) ?? readDate(meta.turntime);
    const fallbackTickMs = Math.max(1, Math.floor(tickSeconds)) * 1_000;
    const scoreStartedAt =
        tickStartedAt && tickStartedAt.getTime() <= now.getTime()
            ? tickStartedAt
            : new Date(now.getTime() - fallbackTickMs);
    return { dayStartedAt, scoreStartedAt };
};

export const upsertGeneralAccess = async (
    db: Pick<GameApiContext['db'], '$executeRaw'>,
    input: {
        generalId: number;
        userId: string;
        weight: number;
        now: Date;
        dayStartedAt: Date;
        scoreStartedAt: Date;
    }
): Promise<void> => {
    await db.$executeRaw(
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
                        OR general_access_log.last_refresh < ${input.dayStartedAt}
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
            select: { tickSeconds: true, meta: true },
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
    const { dayStartedAt, scoreStartedAt } = resolveAccessWindows(now, worldState.tickSeconds, meta);

    await upsertGeneralAccess(ctx.db, {
        generalId: general.id,
        userId: user.id,
        weight,
        now,
        dayStartedAt,
        scoreStartedAt,
    });
    return true;
};
