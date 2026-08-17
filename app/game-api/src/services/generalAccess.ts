import { asRecord, resolveAccessLimitLevel, resolveAccessRefreshLimit, type AccessLimitLevel } from '@sammo-ts/common';
import { GamePrisma } from '@sammo-ts/infra';

import type { GameApiContext } from '../context.js';

export const accessPages = [
    'nation-info',
    'nation-cities',
    'nation-list',
    'current-city',
    'dynasty',
    'traffic',
    'npc-control',
] as const;

export type AccessPage = (typeof accessPages)[number];

export const accessPageWeights: Record<AccessPage, number> = {
    'nation-info': 1,
    'nation-cities': 1,
    'nation-list': 2,
    'current-city': 1,
    dynasty: 1,
    traffic: 1,
    'npc-control': 1,
};

/** One user-visible refresh that has to rebuild PostgreSQL-backed dashboard data. */
export const DASHBOARD_PROJECTION_ACCESS_WEIGHT = 1;

export const generalAccessEndpointWeights = {
    'world.getGeneralDirectory': 2,
    'public.getNpcList': 2,
    'ranking.getBestGeneral': 1,
    'ranking.getHallOfFame': 1,
    'tournament.getSnapshot': 1,
    'nation.getSecretGeneralList': 1,
    'nation.getPersonnelInfo': 1,
    'nation.getGeneralList': 1,
    'general.ensureDieOnPrestartStatus': 1,
    'nation.getStratFinan': 1,
    'board.getArticles': 1,
    'diplomacy.getLetters': 2,
    'battle.getGeneralDetail': 1,
    'betting.getList': 1,
    'yearbook.getHistory': 1,
    'world.getGlobalInfo': 1,
    'nation.getBattleCenter': 1,
    'nation.getChiefCenter': 1,
    'troop.getList': 1,
    'board.writeArticle': 1,
    'board.writeComment': 1,
    'diplomacy.sendLetter': 1,
    'diplomacy.respondLetter': 1,
    'diplomacy.rollbackLetter': 1,
    'diplomacy.destroyLetter': 1,
    'general.buildNationCandidate': 1,
    'general.dieOnPrestart': 1,
    'general.instantRetreat': 1,
    'messages.send': 1,
    'turns.getCommandTable': 1,
    'general.setMySetting': 0,
    'npc.setNationPolicy': 0,
    'npc.setNationPriority': 0,
    'npc.setGeneralPriority': 0,
    'battle.prepareSimulation': 0,
    'battle.simulate': 0,
} as const satisfies Record<string, 0 | 1 | 2>;

export type GeneralAccessEndpoint = keyof typeof generalAccessEndpointWeights;

export const generalAccessLimitPages = new Set<AccessPage>(['nation-list', 'npc-control']);

export const generalAccessLimitEndpoints = new Set<GeneralAccessEndpoint>([
    'world.getGeneralDirectory',
    'tournament.getSnapshot',
    'nation.getSecretGeneralList',
    'nation.getGeneralList',
    'nation.getStratFinan',
    'nation.getBattleCenter',
    'nation.getChiefCenter',
    'board.getArticles',
    'board.writeArticle',
    'board.writeComment',
    'diplomacy.getLetters',
    'diplomacy.sendLetter',
    'diplomacy.respondLetter',
    'diplomacy.rollbackLetter',
    'diplomacy.destroyLetter',
    'betting.getList',
    'yearbook.getHistory',
    'messages.send',
    'turns.getCommandTable',
]);

export type GeneralAccessState = {
    generalId: number;
    refreshScore: number;
    refreshLimit: number;
    level: AccessLimitLevel;
    nextAccessAt: Date;
};

export const resolveGeneralAccessEndpointWeight = (
    path: string,
    input: unknown,
    currentProfileName: string
): 0 | 1 | 2 | null | undefined => {
    const weight = generalAccessEndpointWeights[path as GeneralAccessEndpoint];
    if (weight === undefined) {
        return undefined;
    }
    if (path === 'yearbook.getHistory') {
        const requestedServer =
            typeof input === 'object' && input !== null && 'serverID' in input
                ? (input as { serverID?: unknown }).serverID
                : undefined;
        if (requestedServer !== undefined && requestedServer !== currentProfileName) {
            return null;
        }
    }
    return weight;
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

export const resolveGeneralScoreStartedAt = (tickSeconds: number, nextTurnAt: Date): Date =>
    new Date(nextTurnAt.getTime() - Math.max(1, Math.floor(tickSeconds)) * 1_000);

const formatAccessTime = (value: Date): string => {
    const kst = new Date(value.getTime() + 9 * 60 * 60 * 1_000);
    return kst.toISOString().slice(0, 19).replace('T', ' ');
};

export const formatGeneralAccessLimitMessage = (state: Pick<GeneralAccessState, 'nextAccessAt'>): string =>
    `접속 제한중입니다. 1턴 이내에 너무 많은 갱신을 하셨습니다. ` +
    `(다음 접속 가능 시각: ${formatAccessTime(state.nextAccessAt)}) ` +
    '자신의 턴이 되면 다시 접속 가능합니다. 잠시 쉬어보세요.';

export const getGeneralAccessState = async (
    ctx: Pick<GameApiContext, 'auth' | 'db'>
): Promise<GeneralAccessState | null> => {
    const user = ctx.auth?.user;
    if (!user || user.roles.some((role) => adminRoles.has(role))) {
        return null;
    }
    const [general, worldState] = await Promise.all([
        ctx.db.general.findFirst({
            where: { userId: user.id },
            orderBy: { id: 'asc' },
            select: { id: true, turnTime: true },
        }),
        ctx.db.worldState.findFirst({
            orderBy: { id: 'asc' },
            select: { tickSeconds: true, meta: true },
        }),
    ]);
    if (!general || !worldState) {
        return null;
    }
    const access = await ctx.db.generalAccessLog.findUnique({
        where: { generalId: general.id },
        select: { lastRefresh: true, refreshScore: true },
    });
    const scoreStartedAt = resolveGeneralScoreStartedAt(worldState.tickSeconds, general.turnTime);
    const refreshScore =
        access?.lastRefresh && access.lastRefresh.getTime() < scoreStartedAt.getTime()
            ? 0
            : (access?.refreshScore ?? 0);
    const refreshLimit = resolveAccessRefreshLimit(worldState.tickSeconds, asRecord(worldState.meta).refreshLimit);
    return {
        generalId: general.id,
        refreshScore,
        refreshLimit,
        level: resolveAccessLimitLevel(refreshScore, refreshLimit),
        nextAccessAt: general.turnTime,
    };
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
    ctx: Pick<GameApiContext, 'auth' | 'db' | 'profile' | 'profileStatusSource' | 'readModelOutbox'>,
    page: AccessPage,
    now = new Date()
): Promise<boolean> => recordGeneralAccessWeight(ctx, accessPageWeights[page], now);

export const recordGeneralAccessWeight = async (
    ctx: Pick<GameApiContext, 'auth' | 'db' | 'profile' | 'profileStatusSource' | 'readModelOutbox'>,
    weight: number,
    now = new Date()
): Promise<boolean> => {
    if (!Number.isInteger(weight) || weight < 0) {
        throw new RangeError('General access weight must be a non-negative integer.');
    }
    const user = ctx.auth?.user;
    if (!user || user.roles.some((role) => adminRoles.has(role))) {
        return false;
    }

    const profileStatusSource = ctx.profileStatusSource;
    if (!profileStatusSource) {
        return false;
    }
    try {
        if ((await profileStatusSource.get(ctx.profile.name)) !== 'RUNNING') {
            return false;
        }
    } catch {
        // 상태를 확인하지 못한 요청으로 사용자를 벌주지 않는다. 업무 요청은
        // 계속 진행하고 다음 요청에서 gateway 상태를 다시 확인한다.
        return false;
    }

    const [general, worldState] = await Promise.all([
        ctx.db.general.findFirst({
            where: { userId: user.id },
            orderBy: { id: 'asc' },
            select: { id: true, userId: true, turnTime: true },
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

    const { periodStartedAt } = resolveAccessWindows(now, worldState.tickSeconds, meta);
    const scoreStartedAt = resolveGeneralScoreStartedAt(worldState.tickSeconds, general.turnTime);

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
    ctx.readModelOutbox?.wake();
    return true;
};
