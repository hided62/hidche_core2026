import { TRPCError } from '@trpc/server';
import { asRecord } from '@sammo-ts/common';
import { LogCategory, LogScope } from '@sammo-ts/infra';
import { z } from 'zod';

import type { GameApiContext } from '../../context.js';
import { zWorldStateConfig, zWorldStateMeta } from '../../context.js';
import { loadMapLayout } from '../../maps/mapLayout.js';
import { loadPublicMap } from '../../maps/worldMap.js';
import { accessPages, recordGeneralAccess } from '../../services/generalAccess.js';
import { procedure, router, sessionActivityProcedure } from '../../trpc.js';
import { loadTraitNames } from '../nation/shared.js';

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

type NpcListSort = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

type TrafficHistoryItem = {
    year: number;
    month: number;
    refresh: number;
    online: number;
    date: string;
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

const normalizeTraitKey = (value: string): string | null => (value && value !== 'None' ? value : null);

const readFiniteMetaNumber = (meta: Record<string, unknown>, key: string): number => {
    const value = meta[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const parseTrafficHistory = (value: unknown): TrafficHistoryItem[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    const result: TrafficHistoryItem[] = [];
    for (const item of value) {
        const row = asRecord(item);
        const year = readFiniteMetaNumber(row, 'year');
        const month = readFiniteMetaNumber(row, 'month');
        const refresh = readFiniteMetaNumber(row, 'refresh');
        const online = readFiniteMetaNumber(row, 'online');
        const date = typeof row.date === 'string' ? row.date : '';
        if (year > 0 && month > 0 && date) {
            result.push({ year, month, refresh, online, date });
        }
    }
    return result;
};

const compareString = (left: string, right: string): number => {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
};

const sortNpcList = <T extends {
    name: string;
    nationId: number;
    statTotal: number;
    leadership: number;
    strength: number;
    intelligence: number;
    experience: number;
    dedication: number;
}>(rows: T[], sort: NpcListSort): T[] =>
    rows.sort((left, right) => {
        switch (sort) {
            case 2:
                return left.nationId - right.nationId;
            case 3:
                return right.statTotal - left.statTotal;
            case 4:
                return right.leadership - left.leadership;
            case 5:
                return right.strength - left.strength;
            case 6:
                return right.intelligence - left.intelligence;
            case 7:
                return right.experience - left.experience;
            case 8:
                return right.dedication - left.dedication;
            case 1:
            default:
                return compareString(left.name, right.name);
        }
    });

export const publicRouter = router({
    recordAccess: sessionActivityProcedure
        .input(z.object({ page: z.enum(accessPages) }))
        .mutation(async ({ ctx, input }) => ({
            recorded: await recordGeneralAccess(ctx, input.page),
        })),
    getMapLayout: procedure.query(async ({ ctx }) => {
        return loadMapLayout(ctx.profile.scenario);
    }),
    getCachedMap: procedure.query(async ({ ctx }) => {
        const cacheKey = buildPublicCacheKey(ctx, 'cachedMapWithHistory');
        const cached = await ctx.redis.get(cacheKey);
        if (cached) {
            try {
                return JSON.parse(cached) as NonNullable<Awaited<ReturnType<typeof loadPublicMap>>> & {
                    history: { id: number; text: string }[];
                };
            } catch {
                // Ignore cache parse errors.
            }
        }

        const [map, history] = await Promise.all([
            loadPublicMap(ctx, true),
            ctx.db.logEntry.findMany({
                where: {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                },
                select: {
                    id: true,
                    text: true,
                },
                orderBy: { id: 'desc' },
                take: 10,
            }),
        ]);
        if (!map) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: 'World state is not initialized.',
            });
        }
        const snapshot = {
            ...map,
            history,
        };
        await ctx.redis.set(cacheKey, JSON.stringify(snapshot), { EX: PUBLIC_CACHE_TTL_SECONDS });
        return snapshot;
    }),
    getWorldTrend: procedure.query(async ({ ctx }) => {
        return loadCachedWorldTrend(ctx);
    }),
    getNationList: procedure.query(async ({ ctx }) => {
        return loadCachedNationList(ctx);
    }),
    getTraffic: procedure.query(async ({ ctx }) => {
        const worldState = await ctx.db.worldState.findFirst();
        if (!worldState) {
            throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: 'World state is not initialized.',
            });
        }

        const meta = asRecord(worldState.meta);
        const rawOnlineSince = meta.lastTurnTime ?? meta.turntime;
        const parsedOnlineSince =
            typeof rawOnlineSince === 'string' || rawOnlineSince instanceof Date
                ? new Date(rawOnlineSince)
                : null;
        const onlineSince =
            parsedOnlineSince && Number.isFinite(parsedOnlineSince.getTime())
                ? parsedOnlineSince
                : new Date(Date.now() - worldState.tickSeconds * 1_000);
        const [accessTotal, currentOnline, topAccess] = await Promise.all([
            ctx.db.generalAccessLog.aggregate({
                _sum: {
                    refresh: true,
                    refreshScoreTotal: true,
                },
            }),
            ctx.db.generalAccessLog.count({
                where: {
                    lastRefresh: {
                        gte: onlineSince,
                    },
                },
            }),
            ctx.db.generalAccessLog.findMany({
                orderBy: [{ refresh: 'desc' }, { generalId: 'asc' }],
                take: 5,
                select: {
                    generalId: true,
                    refresh: true,
                    refreshScoreTotal: true,
                },
            }),
        ]);

        const generalIds = topAccess.map((entry) => entry.generalId);
        const generalRows =
            generalIds.length > 0
                ? await ctx.db.general.findMany({
                      where: { id: { in: generalIds } },
                      select: { id: true, name: true },
                  })
                : [];
        const generalName = new Map(generalRows.map((general) => [general.id, general.name]));
        const totalRefresh = accessTotal._sum.refresh ?? 0;
        const totalRefreshScore = accessTotal._sum.refreshScoreTotal ?? 0;
        const currentRefresh = Math.max(readFiniteMetaNumber(meta, 'refresh'), totalRefresh);
        const history = parseTrafficHistory(meta.recentTraffic);
        history.push({
            year: worldState.currentYear,
            month: worldState.currentMonth,
            refresh: currentRefresh,
            online: currentOnline,
            date: new Date().toISOString(),
        });

        return {
            history,
            maxRefresh: Math.max(
                1,
                readFiniteMetaNumber(meta, 'maxrefresh'),
                ...history.map((entry) => entry.refresh)
            ),
            maxOnline: Math.max(1, readFiniteMetaNumber(meta, 'maxonline'), ...history.map((entry) => entry.online)),
            suspects: [
                {
                    generalId: null,
                    name: '접속자 총합',
                    refresh: totalRefresh,
                    refreshScoreTotal: totalRefreshScore,
                },
                ...topAccess.map((entry) => ({
                    generalId: entry.generalId,
                    name: generalName.get(entry.generalId) ?? `장수 ${entry.generalId}`,
                    refresh: entry.refresh,
                    refreshScoreTotal: entry.refreshScoreTotal,
                })),
            ],
        };
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
    getNpcList: procedure
        .input(
            z
                .object({
                    sort: z.number().int().min(1).max(8).catch(1).optional(),
                })
                .optional()
        )
        .query(async ({ ctx, input }) => {
            const sort = (input?.sort ?? 1) as NpcListSort;
            const [generals, nations] = await Promise.all([
                ctx.db.general.findMany({
                    where: { npcState: { gt: 0 } },
                    select: {
                        id: true,
                        name: true,
                        npcState: true,
                        nationId: true,
                        leadership: true,
                        strength: true,
                        intel: true,
                        experience: true,
                        dedication: true,
                        personalCode: true,
                        specialCode: true,
                        special2Code: true,
                        meta: true,
                    },
                    orderBy: { id: 'asc' },
                }),
                ctx.db.nation.findMany({
                    select: { id: true, name: true },
                }),
            ]);

            const personalityKeys = generals.map((general) => normalizeTraitKey(general.personalCode));
            const domesticKeys = generals.map((general) => normalizeTraitKey(general.specialCode));
            const warKeys = generals.map((general) => normalizeTraitKey(general.special2Code));
            const [personalityMap, domesticMap, warMap] = await Promise.all([
                loadTraitNames(personalityKeys, 'personality'),
                loadTraitNames(domesticKeys, 'domestic'),
                loadTraitNames(warKeys, 'war'),
            ]);
            const nationMap = new Map(nations.map((nation) => [nation.id, nation.name]));

            // Legacy select_pool rows preceded possessed NPC rows before its stable-value sort.
            const pool = generals.filter((general) => general.npcState >= 2);
            const possessed = generals.filter((general) => general.npcState === 1);
            const rows = [...pool, ...possessed].map((general) => {
                const meta = asRecord(general.meta);
                const personalityKey = normalizeTraitKey(general.personalCode);
                const domesticKey = normalizeTraitKey(general.specialCode);
                const warKey = normalizeTraitKey(general.special2Code);
                const ownerName =
                    general.npcState === 1
                        ? typeof meta.owner_name === 'string'
                            ? meta.owner_name
                            : typeof meta.ownerName === 'string'
                              ? meta.ownerName
                              : ''
                        : '';

                return {
                    id: general.id,
                    name: general.name,
                    npcState: general.npcState,
                    ownerName,
                    level: readFiniteMetaNumber(meta, 'explevel'),
                    nationId: general.nationId,
                    nationName: nationMap.get(general.nationId) ?? '-',
                    personality: personalityKey
                        ? {
                              key: personalityKey,
                              name: personalityMap.get(personalityKey)?.name ?? personalityKey,
                              info: personalityMap.get(personalityKey)?.info ?? '',
                          }
                        : null,
                    specialDomestic: domesticKey
                        ? {
                              key: domesticKey,
                              name: domesticMap.get(domesticKey)?.name ?? domesticKey,
                              info: domesticMap.get(domesticKey)?.info ?? '',
                          }
                        : null,
                    specialWar: warKey
                        ? {
                              key: warKey,
                              name: warMap.get(warKey)?.name ?? warKey,
                              info: warMap.get(warKey)?.info ?? '',
                          }
                        : null,
                    statTotal: general.leadership + general.strength + general.intel,
                    leadership: general.leadership,
                    strength: general.strength,
                    intelligence: general.intel,
                    experience: general.experience,
                    dedication: general.dedication,
                };
            });

            return {
                sort,
                generals: sortNpcList(rows, sort),
            };
        }),
});
