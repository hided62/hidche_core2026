import { TRPCError } from '@trpc/server';

import type { GameApiContext } from '../../context.js';
import { zWorldStateConfig, zWorldStateMeta } from '../../context.js';
import { loadMapLayout } from '../../maps/mapLayout.js';
import { loadPublicMap } from '../../maps/worldMap.js';
import { procedure, router } from '../../trpc.js';

type WorldTrendSnapshot = {
    year: number;
    month: number;
    userCnt: number;
    maxUserCnt: number;
    npcCnt: number;
    nationCnt: number;
    turnTerm: number;
    fictionMode: string;
    starttime: string;
    opentime: string;
    turntime: string;
    otherTextInfo: string;
    isUnited: number;
};

type NationSummary = {
    id: number;
    name: string;
    color: string;
    level: number;
    capitalCityId: number;
    generalCount: number;
    cityCount: number;
};

type NationCountRow = {
    nationId: number;
    count: number;
};

const PUBLIC_CACHE_TTL_SECONDS = 600;

const buildPublicCacheKey = (ctx: GameApiContext, key: string): string =>
    `sammo:public:${key}:${ctx.profile.id}:${ctx.profile.scenario}`;

const loadWorldTrendSnapshot = async (ctx: GameApiContext): Promise<WorldTrendSnapshot> => {
    const rawWorldState = await ctx.db.worldState.findFirst();
    if (!rawWorldState) {
        throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'World state not found',
        });
    }

    const config = zWorldStateConfig.parse(rawWorldState.config);
    const meta = zWorldStateMeta.parse(rawWorldState.meta);

    const [userCnt, npcCnt, nationCnt] = await Promise.all([
        ctx.db.general.count({ where: { npcState: 0 } }),
        ctx.db.general.count({ where: { npcState: { gt: 0 } } }),
        ctx.db.nation.count({ where: { level: { gt: 0 } } }),
    ]);

    return {
        year: rawWorldState.currentYear,
        month: rawWorldState.currentMonth,
        userCnt,
        maxUserCnt: config.maxUserCnt ?? 500,
        npcCnt,
        nationCnt,
        turnTerm: rawWorldState.tickSeconds / 60,
        fictionMode: config.fictionMode ?? '사실',
        starttime: meta.starttime ?? '',
        opentime: meta.opentime ?? '',
        turntime: meta.turntime ?? '',
        otherTextInfo: meta.otherTextInfo ?? '',
        isUnited: meta.isUnited ?? 0,
    };
};

const loadCachedWorldTrend = async (ctx: GameApiContext): Promise<WorldTrendSnapshot> => {
    const cacheKey = buildPublicCacheKey(ctx, 'worldTrend');
    const cached = await ctx.redis.get(cacheKey);
    if (cached) {
        try {
            return JSON.parse(cached) as WorldTrendSnapshot;
        } catch {
            // Ignore cache parse errors.
        }
    }

    const snapshot = await loadWorldTrendSnapshot(ctx);
    await ctx.redis.set(cacheKey, JSON.stringify(snapshot), { EX: PUBLIC_CACHE_TTL_SECONDS });
    return snapshot;
};

const loadCachedNationList = async (ctx: GameApiContext): Promise<NationSummary[]> => {
    const cacheKey = buildPublicCacheKey(ctx, 'nationList');
    const cached = await ctx.redis.get(cacheKey);
    if (cached) {
        try {
            return JSON.parse(cached) as NationSummary[];
        } catch {
            // Ignore cache parse errors.
        }
    }

    const [nations, generalCounts, cityCounts] = await Promise.all([
        ctx.db.nation.findMany({
            select: {
                id: true,
                name: true,
                color: true,
                level: true,
                capitalCityId: true,
            },
            orderBy: [{ level: 'desc' }, { id: 'asc' }],
        }),
        ctx.db.$queryRaw<NationCountRow[]>`
            SELECT nation_id as "nationId", COUNT(*)::int as "count"
            FROM general
            GROUP BY nation_id
        `,
        ctx.db.$queryRaw<NationCountRow[]>`
            SELECT nation_id as "nationId", COUNT(*)::int as "count"
            FROM city
            GROUP BY nation_id
        `,
    ]);

    const generalCountMap = new Map<number, number>();
    for (const row of generalCounts) {
        generalCountMap.set(row.nationId, row.count);
    }

    const cityCountMap = new Map<number, number>();
    for (const row of cityCounts) {
        cityCountMap.set(row.nationId, row.count);
    }

    const summary = nations.map((nation) => ({
        id: nation.id,
        name: nation.name,
        color: nation.color,
        level: nation.level,
        capitalCityId: nation.capitalCityId ?? 0,
        generalCount: generalCountMap.get(nation.id) ?? 0,
        cityCount: cityCountMap.get(nation.id) ?? 0,
    }));

    await ctx.redis.set(cacheKey, JSON.stringify(summary), { EX: PUBLIC_CACHE_TTL_SECONDS });
    return summary;
};

export const publicRouter = router({
    getMapLayout: procedure.query(async ({ ctx }) => {
        return loadMapLayout(ctx.profile.scenario);
    }),
    getCachedMap: procedure.query(async ({ ctx }) => {
        const map = await loadPublicMap(ctx, true);
        if (!map) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: 'World state is not initialized.',
            });
        }
        return map;
    }),
    getWorldTrend: procedure.query(async ({ ctx }) => {
        return loadCachedWorldTrend(ctx);
    }),
    getNationList: procedure.query(async ({ ctx }) => {
        return loadCachedNationList(ctx);
    }),
    getGeneralList: procedure.query(async ({ ctx }) => {
        const [generals, nations] = await Promise.all([
            ctx.db.general.findMany({
                select: {
                    id: true,
                    name: true,
                    npcState: true,
                    nationId: true,
                    leadership: true,
                    strength: true,
                    intel: true,
                },
            }),
            ctx.db.nation.findMany({
                select: {
                    id: true,
                    name: true,
                },
            }),
        ]);

        const nationMap = new Map<number, string>();
        for (const nation of nations) {
            nationMap.set(nation.id, nation.name);
        }

        return generals.map((general) => ({
            id: general.id,
            name: general.name,
            npcState: general.npcState,
            nationId: general.nationId,
            nationName: nationMap.get(general.nationId) ?? '무주',
            leadership: general.leadership,
            strength: general.strength,
            intelligence: general.intel,
        }));
    }),
});
