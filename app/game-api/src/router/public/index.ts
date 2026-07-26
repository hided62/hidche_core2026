import { TRPCError } from '@trpc/server';
import { asRecord } from '@sammo-ts/common';

import type { GameApiContext } from '../../context.js';
import { zWorldStateConfig, zWorldStateMeta } from '../../context.js';
import { loadMapLayout } from '../../maps/mapLayout.js';
import { loadPublicMap } from '../../maps/worldMap.js';
import { procedure, router } from '../../trpc.js';
import { loadTraitNames } from '../nation/shared.js';
import { z } from 'zod';

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
