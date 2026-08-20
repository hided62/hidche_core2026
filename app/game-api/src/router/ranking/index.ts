import { z } from 'zod';

import { asRecord, HALL_OF_FAME_TYPES, type HallOfFameType } from '@sammo-ts/common';
import { ITEM_KEYS, ItemLoader, loadItemModules } from '@sammo-ts/logic/items/index.js';
import type { ItemModule } from '@sammo-ts/logic/items/types.js';
import { buildLegacyDefaultUniqueItemPool } from '@sammo-ts/logic/rewards/legacyUniqueItemPool.js';
import { resolveUniqueConfig } from '@sammo-ts/logic/rewards/uniqueLottery.js';

import { accessAuthedInputProcedure, accessInputProcedure, procedure, router } from '../../trpc.js';
import {
    findLegacyHallOptions,
    findLegacyHallRows,
    isLegacyArchiveProfile,
} from '../../services/legacyArchiveStore.js';

const DEFAULT_BG_COLOR = '#330000';
const DEFAULT_FG_COLOR = '#ffffff';
const NEUTRAL_BG_COLOR = '#000000';
const LEGACY_WHITE_TEXT_COLORS = new Set([
    '',
    '#330000',
    '#FF0000',
    '#800000',
    '#A0522D',
    '#FF6347',
    '#808000',
    '#008000',
    '#2E8B57',
    '#008080',
    '#6495ED',
    '#0000FF',
    '#000080',
    '#483D8B',
    '#7B68EE',
    '#800080',
    '#A9A9A9',
    '#000000',
]);

const readMetaNumber = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed);
        }
    }
    return 0;
};

export const formatLegacyRankingNumber = (value: number, fractionDigits = 0): string =>
    new Intl.NumberFormat('en-US', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
        useGrouping: true,
    }).format(value);

export const resolveLegacyTextColor = (backgroundColor: string): string =>
    LEGACY_WHITE_TEXT_COLORS.has(backgroundColor.toUpperCase()) ? '#ffffff' : '#000000';

const percentText = (value: number): string => `${formatLegacyRankingNumber(value * 100, 2)}%`;

const readOwnerDisplayName = (value: unknown): string | null => {
    const meta = asRecord(value);
    if (typeof meta.ownerName === 'string' && meta.ownerName.length > 0) {
        return meta.ownerName;
    }
    if (typeof meta.owner_name === 'string' && meta.owner_name.length > 0) {
        return meta.owner_name;
    }
    return null;
};

const itemLoader = new ItemLoader();
let cachedUniqueItems: Promise<ItemModule[]> | null = null;

const loadUniqueItems = () => {
    if (!cachedUniqueItems) {
        cachedUniqueItems = loadItemModules([...ITEM_KEYS], itemLoader).then((modules) =>
            modules.filter((module) => module.unique && !module.buyable)
        );
    }
    return cachedUniqueItems;
};

export const rankingRouter = router({
    getBestGeneral: accessAuthedInputProcedure(
        z
            .object({
                view: z.enum(['user', 'npc']).optional(),
            })
            .optional()
    ).query(async ({ ctx, input }) => {
        const worldState = await ctx.db.worldState.findFirst({
            select: { meta: true, config: true },
        });
        const meta = asRecord(worldState?.meta);
        const isUnited = typeof meta.isUnited === 'number' && meta.isUnited !== 0;

        const view = input?.view ?? 'user';
        const npcFilter = view === 'npc' ? { gte: 2 } : { lt: 2 };

        const [nations, generals] = await Promise.all([
            ctx.db.nation.findMany({ select: { id: true, name: true, color: true } }),
            ctx.db.general.findMany({
                where: { npcState: npcFilter },
                orderBy: { id: 'asc' },
                select: {
                    id: true,
                    name: true,
                    nationId: true,
                    userId: true,
                    picture: true,
                    imageServer: true,
                    meta: true,
                    experience: true,
                    dedication: true,
                    horseCode: true,
                    weaponCode: true,
                    bookCode: true,
                    itemCode: true,
                },
            }),
        ]);

        const nationMap = new Map(nations.map((nation) => [nation.id, nation]));
        const generalIds = generals.map((general) => general.id);
        const rankRows = await ctx.db.rankData.findMany({
            where: { generalId: { in: generalIds } },
            select: { generalId: true, type: true, value: true },
        });
        const rankMap = new Map<number, Record<string, number>>();
        for (const row of rankRows) {
            const entry = rankMap.get(row.generalId) ?? {};
            entry[row.type] = row.value;
            rankMap.set(row.generalId, entry);
        }

        const types: Array<
            [string, 'int' | 'percent', (general: (typeof generals)[number], ranks: Record<string, number>) => number]
        > = [
            ['명 성', 'int', (g) => g.experience],
            ['계 급', 'int', (g) => g.dedication],
            ['계 략 성 공', 'int', (_g, r) => r.firenum ?? 0],
            ['전 투 횟 수', 'int', (_g, r) => r.warnum ?? 0],
            ['승 리', 'int', (_g, r) => r.killnum ?? 0],
            [
                '승 률',
                'percent',
                (_g, r) => {
                    const warnum = r.warnum ?? 0;
                    if (warnum < 10) {
                        return 0;
                    }
                    return (r.killnum ?? 0) / Math.max(1, warnum);
                },
            ],
            ['점 령', 'int', (_g, r) => r.occupied ?? 0],
            ['사 살', 'int', (_g, r) => r.killcrew ?? 0],
            [
                '살 상 률',
                'percent',
                (_g, r) => {
                    const warnum = r.warnum ?? 0;
                    if (warnum < 10) {
                        return 0;
                    }
                    return (r.killcrew ?? 0) / Math.max(1, r.deathcrew ?? 0);
                },
            ],
            ['대 인 사 살', 'int', (_g, r) => r.killcrew_person ?? 0],
            [
                '대 인 살 상 률',
                'percent',
                (_g, r) => {
                    const warnum = r.warnum ?? 0;
                    if (warnum < 10) {
                        return 0;
                    }
                    return (r.killcrew_person ?? 0) / Math.max(1, r.deathcrew_person ?? 0);
                },
            ],
            ['보 병 숙 련 도', 'int', (g) => readMetaNumber(asRecord(g.meta).dex1)],
            ['궁 병 숙 련 도', 'int', (g) => readMetaNumber(asRecord(g.meta).dex2)],
            ['기 병 숙 련 도', 'int', (g) => readMetaNumber(asRecord(g.meta).dex3)],
            ['귀 병 숙 련 도', 'int', (g) => readMetaNumber(asRecord(g.meta).dex4)],
            ['차 병 숙 련 도', 'int', (g) => readMetaNumber(asRecord(g.meta).dex5)],
            [
                '전 력 전 승 률',
                'percent',
                (_g, r) => {
                    const total = (r.ttw ?? 0) + (r.ttd ?? 0) + (r.ttl ?? 0);
                    if (total < 50) {
                        return 0;
                    }
                    return (r.ttw ?? 0) / Math.max(1, total);
                },
            ],
            [
                '통 솔 전 승 률',
                'percent',
                (_g, r) => {
                    const total = (r.tlw ?? 0) + (r.tld ?? 0) + (r.tll ?? 0);
                    if (total < 50) {
                        return 0;
                    }
                    return (r.tlw ?? 0) / Math.max(1, total);
                },
            ],
            [
                '일 기 토 승 률',
                'percent',
                (_g, r) => {
                    const total = (r.tsw ?? 0) + (r.tsd ?? 0) + (r.tsl ?? 0);
                    if (total < 50) {
                        return 0;
                    }
                    return (r.tsw ?? 0) / Math.max(1, total);
                },
            ],
            [
                '설 전 승 률',
                'percent',
                (_g, r) => {
                    const total = (r.tiw ?? 0) + (r.tid ?? 0) + (r.til ?? 0);
                    if (total < 50) {
                        return 0;
                    }
                    return (r.tiw ?? 0) / Math.max(1, total);
                },
            ],
            ['베 팅 투 자 액', 'int', (_g, r) => r.betgold ?? 0],
            ['베 팅 당 첨', 'int', (_g, r) => r.betwin ?? 0],
            ['베 팅 수 익 금', 'int', (_g, r) => r.betwingold ?? 0],
            [
                '베 팅 수 익 률',
                'percent',
                (_g, r) => {
                    const betgold = r.betgold ?? 0;
                    if (betgold < 1000) {
                        return 0;
                    }
                    return (r.betwingold ?? 0) / Math.max(1, betgold);
                },
            ],
            ['유 산 소 모 량', 'int', (_g, r) => r.inherit_spent ?? 0],
            ['유 산 획 득 량', 'int', (_g, r) => r.inherit_earned ?? 0],
        ];

        const sections = types.map(([title, valueType, valueFn]) => {
            const entries = generals
                .map((general) => {
                    const ranks = rankMap.get(general.id) ?? {};
                    const value = valueFn(general, ranks);
                    const nation = nationMap.get(general.nationId) ?? null;
                    const bgColor = nation?.color ?? (general.nationId === 0 ? NEUTRAL_BG_COLOR : DEFAULT_BG_COLOR);
                    let display = {
                        id: general.id,
                        name: general.name,
                        ownerName: isUnited ? readOwnerDisplayName(general.meta) : null,
                        nationName: nation?.name ?? '재야',
                        bgColor,
                        fgColor: resolveLegacyTextColor(bgColor),
                        picture: general.picture ?? null,
                        imageServer: general.imageServer ?? 0,
                        value,
                        printValue: valueType === 'percent' ? percentText(value) : formatLegacyRankingNumber(value),
                    };

                    if (
                        !isUnited &&
                        (title === '계 략 성 공' || title === '유 산 소 모 량' || title === '유 산 획 득 량')
                    ) {
                        display = {
                            ...display,
                            name: '???',
                            ownerName: null,
                            nationName: '???',
                            bgColor: DEFAULT_BG_COLOR,
                            fgColor: resolveLegacyTextColor(DEFAULT_BG_COLOR),
                            picture: null,
                            imageServer: 0,
                        };
                    }
                    return display;
                })
                .filter((entry) => entry.value > 0)
                .sort((a, b) => b.value - a.value)
                .slice(0, 10);

            return { title, valueType, entries };
        });

        const uniqueItems = await loadUniqueItems();
        const itemRegistry = new Map(uniqueItems.map((item) => [item.key, item]));
        const uniqueConfig = resolveUniqueConfig(asRecord(asRecord(worldState?.config).const));
        if (Object.keys(uniqueConfig.allItems).length === 0) {
            uniqueConfig.allItems = buildLegacyDefaultUniqueItemPool(itemRegistry);
        }
        const activeAuctions = await ctx.db.auction.findMany({
            where: {
                type: 'UNIQUE_ITEM',
                status: { in: ['OPEN', 'FINALIZING'] },
                targetCode: { not: null },
            },
            select: { targetCode: true },
        });
        const auctionCounts = new Map<string, number>();
        for (const auction of activeAuctions) {
            if (auction.targetCode) {
                auctionCounts.set(auction.targetCode, (auctionCounts.get(auction.targetCode) ?? 0) + 1);
            }
        }
        const slotTitles = {
            horse: '명 마',
            weapon: '명 검',
            book: '명 서',
            item: '도 구',
        } as const;
        const itemEntries = (['horse', 'weapon', 'book', 'item'] as const).map((slot) => {
            const configuredItems = Object.entries(uniqueConfig.allItems[slot] ?? {}).reverse();
            const entries = configuredItems.flatMap(([itemKey, rawCount]) => {
                const item = itemRegistry.get(itemKey);
                if (!item || item.buyable) {
                    return [];
                }
                const owners = generals
                    .filter((general) => {
                        if (slot === 'horse') {
                            return general.horseCode === itemKey;
                        }
                        if (slot === 'weapon') {
                            return general.weaponCode === itemKey;
                        }
                        if (slot === 'book') {
                            return general.bookCode === itemKey;
                        }
                        return general.itemCode === itemKey;
                    })
                    .map((general) => {
                        const nation = nationMap.get(general.nationId) ?? null;
                        const bgColor = nation?.color ?? (general.nationId === 0 ? NEUTRAL_BG_COLOR : DEFAULT_BG_COLOR);
                        return {
                            id: general.id,
                            name: general.name,
                            nationName: nation?.name ?? '재야',
                            bgColor,
                            fgColor: resolveLegacyTextColor(bgColor),
                            picture: general.picture ?? null,
                            imageServer: general.imageServer ?? 0,
                        };
                    });
                for (let index = 0; index < (auctionCounts.get(itemKey) ?? 0); index += 1) {
                    owners.push({
                        id: 0,
                        name: '경매중',
                        nationName: '-',
                        bgColor: '#00582c',
                        fgColor: '#ffffff',
                        picture: null,
                        imageServer: 0,
                    });
                }
                const count = Math.max(0, Math.floor(rawCount));
                return Array.from({ length: count }, (_, index) => ({
                    itemKey,
                    itemName: item.name,
                    itemInfo: item.info,
                    owner: owners[index] ?? {
                        id: 0,
                        name: '미발견',
                        nationName: '-',
                        bgColor: DEFAULT_BG_COLOR,
                        fgColor: resolveLegacyTextColor(DEFAULT_BG_COLOR),
                        picture: null,
                        imageServer: 0,
                    },
                }));
            });
            return { title: slotTitles[slot], slot, entries };
        });

        return {
            isUnited,
            sections,
            uniqueItems: itemEntries,
        };
    }),
    getHallOfFameOptions: procedure
        .input(z.object({ source: z.enum(['current', 'legacy']).default('current') }).optional())
        .query(async ({ ctx, input }) => {
            if ((input?.source ?? 'current') === 'legacy') {
                if (!isLegacyArchiveProfile(ctx.profile.id)) return [];
                const rows = await findLegacyHallOptions(ctx.db, ctx.profile.id);
                const optionMap = new Map<
                    string,
                    {
                        sourceProfile: typeof ctx.profile.id;
                        season: number;
                        scenarios: Array<{ id: number; name: string; count: number }>;
                    }
                >();
                for (const row of rows) {
                    const key = `${row.sourceProfile}:${row.season}`;
                    const entry = optionMap.get(key) ?? {
                        sourceProfile: row.sourceProfile,
                        season: row.season,
                        scenarios: [],
                    };
                    entry.scenarios.push({ id: row.scenario, name: row.scenarioName, count: Number(row.count) });
                    optionMap.set(key, entry);
                }
                return Array.from(optionMap.values());
            }
            const rows = await ctx.db.gameHistory.findMany({
                where: { status: 'COMPLETED' },
                select: { season: true, scenario: true, scenarioName: true },
                orderBy: [{ season: 'desc' }, { scenario: 'asc' }],
            });
            const seasonMap = new Map<
                number,
                { sourceProfile: string; season: number; scenarios: Array<{ id: number; name: string; count: number }> }
            >();
            for (const row of rows) {
                const entry = seasonMap.get(row.season) ?? {
                    sourceProfile: ctx.profile.id,
                    season: row.season,
                    scenarios: [],
                };
                const scenario = entry.scenarios.find((item) => item.id === row.scenario);
                if (scenario) {
                    scenario.count += 1;
                } else {
                    entry.scenarios.push({ id: row.scenario, name: row.scenarioName, count: 1 });
                }
                seasonMap.set(row.season, entry);
            }
            return Array.from(seasonMap.values());
        }),
    getHallOfFame: accessInputProcedure(
        z.object({
            source: z.enum(['current', 'legacy']).default('current'),
            season: z.number().int(),
            scenario: z.number().int().optional(),
        })
    ).query(async ({ ctx, input }) => {
        const baseWhere = {
            season: input.season,
            ...(input.scenario !== undefined ? { scenario: input.scenario } : {}),
        };

        const types: Array<{ key: HallOfFameType; title: string; type: 'int' | 'percent' }> = [
            { key: 'experience', title: '명 성', type: 'int' },
            { key: 'dedication', title: '계 급', type: 'int' },
            { key: 'firenum', title: '계 략 성 공', type: 'int' },
            { key: 'warnum', title: '전 투 횟 수', type: 'int' },
            { key: 'killnum', title: '승 리', type: 'int' },
            { key: 'winrate', title: '승 률', type: 'percent' },
            { key: 'occupied', title: '점 령', type: 'int' },
            { key: 'killcrew', title: '사 살', type: 'int' },
            { key: 'killrate', title: '살 상 률', type: 'percent' },
            { key: 'killcrew_person', title: '대 인 사 살', type: 'int' },
            { key: 'killrate_person', title: '대 인 살 상 률', type: 'percent' },
            { key: 'dex1', title: '보 병 숙 련 도', type: 'int' },
            { key: 'dex2', title: '궁 병 숙 련 도', type: 'int' },
            { key: 'dex3', title: '기 병 숙 련 도', type: 'int' },
            { key: 'dex4', title: '귀 병 숙 련 도', type: 'int' },
            { key: 'dex5', title: '차 병 숙 련 도', type: 'int' },
            { key: 'ttrate', title: '전 력 전 승 률', type: 'percent' },
            { key: 'tlrate', title: '통 솔 전 승 률', type: 'percent' },
            { key: 'tsrate', title: '일 기 토 승 률', type: 'percent' },
            { key: 'tirate', title: '설 전 승 률', type: 'percent' },
            { key: 'betgold', title: '베 팅 투 자 액', type: 'int' },
            { key: 'betwin', title: '베 팅 당 첨', type: 'int' },
            { key: 'betwingold', title: '베 팅 수 익 금', type: 'int' },
            { key: 'betrate', title: '베 팅 수 익 률', type: 'percent' },
        ];
        const allowedTypes = new Set(HALL_OF_FAME_TYPES);

        const sections = await Promise.all(
            types.map(async (type) => {
                if (!allowedTypes.has(type.key)) {
                    return { title: type.title, valueType: type.type, entries: [] };
                }
                const rows =
                    input.source === 'legacy'
                        ? isLegacyArchiveProfile(ctx.profile.id)
                            ? await findLegacyHallRows(ctx.db, {
                                  sourceProfile: ctx.profile.id,
                                  season: input.season,
                                  ...(input.scenario === undefined ? {} : { scenario: input.scenario }),
                                  type: type.key,
                                  take: 10,
                              })
                            : []
                        : await ctx.db.hallOfFame.findMany({
                              where: { ...baseWhere, type: type.key },
                              orderBy: { value: 'desc' },
                              take: 10,
                          });
                const entries = rows.map((row) => {
                    const aux = asRecord(row.aux);
                    return {
                        generalId: row.generalNo,
                        name: String(aux.name ?? ''),
                        ownerName:
                            typeof aux.ownerDisplayName === 'string' && aux.ownerDisplayName.length > 0
                                ? aux.ownerDisplayName
                                : null,
                        nationName: String(aux.nationName ?? ''),
                        bgColor: String(aux.bgColor ?? DEFAULT_BG_COLOR),
                        fgColor: String(aux.fgColor ?? DEFAULT_FG_COLOR),
                        picture: typeof aux.picture === 'string' ? aux.picture : null,
                        imageServer: readMetaNumber(aux.imgsvr),
                        value: row.value,
                        printValue:
                            type.type === 'percent' ? percentText(row.value) : formatLegacyRankingNumber(row.value),
                        serverName: String(aux.serverName ?? ''),
                        serverIdx: readMetaNumber(aux.serverIdx),
                        scenarioName: String(aux.scenarioName ?? ''),
                        startTime: typeof aux.startTime === 'string' ? aux.startTime : null,
                        unitedTime: typeof aux.unitedTime === 'string' ? aux.unitedTime : null,
                    };
                });
                return { title: type.title, valueType: type.type, entries };
            })
        );

        return { source: input.source, sourceProfile: ctx.profile.id, sections };
    }),
});
