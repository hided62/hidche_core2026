import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { RANK_DATA_TYPES } from '@sammo-ts/common';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import type { DatabaseClient, GameApiContext, GameProfile } from '../src/context.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { appRouter } from '../src/router.js';
import { formatLegacyRankingNumber, resolveLegacyTextColor } from '../src/router/ranking/index.js';

const profile: GameProfile = {
    id: 'che',
    scenario: 'default',
    name: 'che:default',
};

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che',
    issuedAt: '2026-07-26T00:00:00.000Z',
    expiresAt: '2026-07-27T00:00:00.000Z',
    sessionId: 'ranking-session',
    user: {
        id: 'request-user-id',
        username: 'ranking-user',
        displayName: '조회자',
        roles: [],
    },
    sanctions: {},
};

interface RankingGeneralRow {
    id: number;
    name: string;
    nationId: number;
    userId: string | null;
    npcState: number;
    picture: string | null;
    imageServer: number;
    meta: Record<string, string | number>;
    experience: number;
    dedication: number;
    horseCode: string;
    weaponCode: string;
    bookCode: string;
    itemCode: string;
}

const generalRows: RankingGeneralRow[] = [
    {
        id: 1,
        name: '유비',
        nationId: 1,
        userId: 'private-user-id-1',
        npcState: 0,
        picture: '1.jpg',
        imageServer: 0,
        meta: { ownerName: '공개소유자', dex1: 120 },
        experience: 1200,
        dedication: 900,
        horseCode: 'che_명마_15_적토마',
        weaponCode: 'None',
        bookCode: 'None',
        itemCode: 'None',
    },
    {
        id: 2,
        name: '빙의관우',
        nationId: 1,
        userId: 'private-user-id-2',
        npcState: 1,
        picture: null,
        imageServer: 0,
        meta: { owner_name: '빙의소유자', dex1: 80 },
        experience: 1100,
        dedication: 800,
        horseCode: 'None',
        weaponCode: 'None',
        bookCode: 'None',
        itemCode: 'None',
    },
    {
        id: 3,
        name: 'NPC조조',
        nationId: 2,
        userId: null,
        npcState: 2,
        picture: null,
        imageServer: 0,
        meta: { dex1: 200 },
        experience: 1300,
        dedication: 1000,
        horseCode: 'None',
        weaponCode: 'None',
        bookCode: 'None',
        itemCode: 'None',
    },
];

const buildContext = (options?: {
    authenticated?: boolean;
    isUnited?: boolean;
    includeOwnerDisplayName?: boolean;
    profileId?: string;
    generals?: RankingGeneralRow[];
    rankRows?: Array<{ generalId: number; type: string; value: number }>;
    gameHistoryFindMany?: (args: unknown) => Promise<Array<{ season: number; scenario: number; scenarioName: string }>>;
}): GameApiContext => {
    const selectedGeneralRows = options?.generals ?? generalRows;
    const selectedProfile = options?.profileId
        ? { ...profile, id: options.profileId, name: `${options.profileId}:default` }
        : profile;
    const db = {
        $queryRaw: async (query: { strings?: readonly string[]; values?: unknown[] }) => {
            const sql = query.strings?.join(' ') ?? '';
            if (sql.includes('legacy_archive"."game_history')) {
                if (!query.values?.includes(selectedProfile.id)) return [];
                const sourceProfile = selectedProfile.id;
                return [
                    {
                        sourceProfile,
                        season: 1,
                        scenario: 7,
                        scenarioName: `${sourceProfile.toUpperCase()} 이전 시나리오`,
                        count: 2n,
                    },
                ];
            }
            if (sql.includes('legacy_archive"."hall')) {
                if (!query.values?.includes(selectedProfile.id)) return [];
                const sourceProfile = selectedProfile.id;
                return query.values?.includes('experience')
                    ? [
                          {
                              sourceProfile,
                              serverId: `${sourceProfile}-old-1`,
                              generalNo: 9,
                              type: 'experience',
                              value: 777,
                              owner: 'private-legacy-owner-id',
                              aux: {
                                  name: '과거장수',
                                  ownerDisplayName: '과거소유자',
                                  nationName: '과거국',
                                  bgColor: '#330000',
                                  fgColor: '#ffffff',
                              },
                          },
                      ]
                    : [];
            }
            return [];
        },
        worldState: {
            findFirst: async () => ({
                meta: { isUnited: options?.isUnited ? 1 : 0 },
                config: {
                    const: {
                        allItems: {
                            horse: { che_명마_15_적토마: 2 },
                            weapon: {},
                            book: {},
                            item: {},
                        },
                    },
                },
            }),
        },
        nation: {
            findMany: async () => [
                { id: 1, name: '촉', color: '#006400' },
                { id: 2, name: '위', color: '#8b0000' },
            ],
        },
        general: {
            findMany: async (args: { where: { npcState: { lt?: number; gte?: number } } }) =>
                selectedGeneralRows.filter((general) =>
                    args.where.npcState.gte !== undefined
                        ? general.npcState >= args.where.npcState.gte
                        : general.npcState < (args.where.npcState.lt ?? Number.POSITIVE_INFINITY)
                ),
        },
        rankData: {
            findMany: async () =>
                options?.rankRows ?? [
                    { generalId: 1, type: 'firenum', value: 10 },
                    { generalId: 2, type: 'firenum', value: 20 },
                    { generalId: 3, type: 'firenum', value: 30 },
                    { generalId: 1, type: 'dex1', value: 999 },
                    { generalId: 2, type: 'dex1', value: 999 },
                    { generalId: 3, type: 'dex1', value: 999 },
                ],
        },
        auction: {
            findMany: async () => [{ targetCode: 'che_명마_15_적토마' }],
        },
        gameHistory: {
            findMany:
                options?.gameHistoryFindMany ??
                (async () => [
                    { season: 3, scenario: 22, scenarioName: '가상모드22' },
                    { season: 3, scenario: 22, scenarioName: '가상모드22' },
                ]),
        },
        hallOfFame: {
            findMany: async (args: { where: { type: string } }) =>
                args.where.type === 'experience' || args.where.type === 'inherit_earned'
                    ? [
                          {
                              generalNo: 1,
                              value: args.where.type === 'experience' ? 1200 : 4321,
                              aux: {
                                  name: '유비',
                                  ownerName: 'private-hall-user-id',
                                  ...(options?.includeOwnerDisplayName ? { ownerDisplayName: '공개소유자' } : {}),
                                  nationName: '촉',
                                  bgColor: '#006400',
                                  fgColor: '#ffffff',
                              },
                          },
                      ]
                    : [],
        },
    };
    const redis = {
        get: async () => null,
        set: async () => null,
    } as unknown as RedisConnector['client'];

    return {
        db: db as unknown as DatabaseClient,
        turnDaemon: new InMemoryTurnDaemonTransport(),
        battleSim: new InMemoryBattleSimTransport(),
        profile: selectedProfile,
        auth: options?.authenticated === false ? null : auth,
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        redis,
        accessTokenStore: new RedisAccessTokenStore(redis, selectedProfile.name),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
};

describe('ranking.getBestGeneral', () => {
    it('requires a game login even though the ranking is the same for every authenticated user', async () => {
        await expect(
            appRouter.createCaller(buildContext({ authenticated: false })).ranking.getBestGeneral({ view: 'user' })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('keeps possessed generals in the user view and redacts account identifiers before unification', async () => {
        const result = await appRouter.createCaller(buildContext({ isUnited: false })).ranking.getBestGeneral({
            view: 'user',
        });

        expect(result.sections[0]?.entries.map((entry) => entry.id)).toEqual([1, 2]);
        expect(result.sections[0]?.entries.map((entry) => entry.ownerName)).toEqual([null, null]);
        expect(result.sections.find((section) => section.title === '계 략 성 공')?.entries).toEqual([
            expect.objectContaining({ id: 2, name: '???', nationName: '???', ownerName: null }),
            expect.objectContaining({ id: 1, name: '???', nationName: '???', ownerName: null }),
        ]);
        expect(JSON.stringify(result)).not.toContain('private-user-id');
    });

    it('uses display names only after unification and preserves configured item copies plus auctions', async () => {
        const result = await appRouter.createCaller(buildContext({ isUnited: true })).ranking.getBestGeneral({
            view: 'user',
        });

        expect(result.sections[0]?.entries.map((entry) => entry.ownerName)).toEqual(['공개소유자', '빙의소유자']);
        expect(result.uniqueItems.find((section) => section.slot === 'horse')?.entries).toEqual([
            expect.objectContaining({
                itemKey: 'che_명마_15_적토마',
                owner: expect.objectContaining({ id: 1, name: '유비' }),
            }),
            expect.objectContaining({
                itemKey: 'che_명마_15_적토마',
                owner: expect.objectContaining({ id: 0, name: '경매중' }),
            }),
        ]);
        expect(JSON.stringify(result)).not.toContain('private-user-id');
    });

    it('separates autonomous NPCs from users and possessed generals', async () => {
        const result = await appRouter.createCaller(buildContext()).ranking.getBestGeneral({ view: 'npc' });
        expect(result.sections[0]?.entries.map((entry) => entry.id)).toEqual([3]);
    });

    it('uses the general dex columns as the legacy source of truth instead of mirrored rank rows', async () => {
        const result = await appRouter.createCaller(buildContext()).ranking.getBestGeneral({ view: 'user' });
        const dex = result.sections.find((section) => section.title === '보 병 숙 련 도');

        expect(dex?.entries.map((entry) => [entry.id, entry.value, entry.printValue])).toEqual([
            [1, 120, '120'],
            [2, 80, '80'],
        ]);
        expect(dex?.entries[0]).toMatchObject({
            bgColor: '#006400',
            fgColor: '#000000',
        });
    });

    it('excludes 100th-season event mastery from current Best General values', async () => {
        const generals = [
            {
                ...generalRows[0]!,
                meta: {
                    ...generalRows[0]!.meta,
                    dex1: 120,
                    event100_allstar: { granted: { dex1: 70 } },
                } as unknown as RankingGeneralRow['meta'],
            },
        ];
        const result = await appRouter.createCaller(buildContext({ generals })).ranking.getBestGeneral({
            view: 'user',
        });

        expect(result.sections.find((section) => section.title === '보 병 숙 련 도')?.entries[0]).toMatchObject({
            id: 1,
            value: 50,
            printValue: '50',
        });
    });

    it('returns positions one through ten for every populated ranking section', async () => {
        const generals = Array.from({ length: 12 }, (_, index) => {
            const id = index + 1;
            const value = id * 1_000;
            return {
                id,
                name: `상위${id}`,
                nationId: 1,
                userId: `top-${id}`,
                npcState: 0,
                picture: null,
                imageServer: 0,
                meta: { dex1: value, dex2: value, dex3: value, dex4: value, dex5: value },
                experience: value,
                dedication: value,
                horseCode: 'None',
                weaponCode: 'None',
                bookCode: 'None',
                itemCode: 'None',
            };
        });
        const rankRows = generals.flatMap((general) =>
            RANK_DATA_TYPES.filter(
                (type) => type !== 'experience' && type !== 'dedication' && !type.startsWith('dex')
            ).map((type) => ({
                generalId: general.id,
                type,
                value:
                    type === 'warnum' || type === 'deathcrew' || type === 'deathcrew_person'
                        ? 1_000
                        : type === 'ttd' ||
                            type === 'ttl' ||
                            type === 'tld' ||
                            type === 'tll' ||
                            type === 'tsd' ||
                            type === 'tsl' ||
                            type === 'tid' ||
                            type === 'til' ||
                            type === 'betgold'
                          ? 1_000
                          : general.id * 1_000,
            }))
        );
        const result = await appRouter
            .createCaller(buildContext({ isUnited: true, generals, rankRows }))
            .ranking.getBestGeneral({ view: 'user' });

        expect(result.sections).toHaveLength(26);
        for (const section of result.sections) {
            expect(section.entries, section.title).toHaveLength(10);
            expect(new Set(section.entries.map((entry) => entry.id)).size, section.title).toBe(10);
            expect(
                section.entries.every((entry) => entry.value > 0),
                section.title
            ).toBe(true);
        }
        expect(
            result.sections.find((section) => section.title === '계 략 성 공')?.entries.map((entry) => entry.id)
        ).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    });

    it('matches PHP number_format rounding and the legacy fixed color table', () => {
        expect(formatLegacyRankingNumber(1.005, 2)).toBe('1.01');
        expect(formatLegacyRankingNumber(12345.6, 2)).toBe('12,345.60');
        expect(resolveLegacyTextColor('#006400')).toBe('#000000');
        expect(resolveLegacyTextColor('#330000')).toBe('#ffffff');
    });
});

describe('ranking hall of fame', () => {
    it('remains public and groups scenario counts', async () => {
        const options = await appRouter
            .createCaller(buildContext({ authenticated: false }))
            .ranking.getHallOfFameOptions();
        expect(options).toEqual([
            {
                sourceProfile: 'che',
                season: 3,
                scenarios: [{ id: 22, name: '가상모드22', count: 2 }],
            },
        ]);
    });

    it('includes the active OPEN game while excluding ABANDONED options', async () => {
        const findMany = vi.fn(async () => [
            { season: 4, scenario: 23, scenarioName: '현재 시나리오' },
            { season: 3, scenario: 22, scenarioName: '완료 시나리오' },
        ]);
        const options = await appRouter
            .createCaller(buildContext({ authenticated: false, gameHistoryFindMany: findMany }))
            .ranking.getHallOfFameOptions();

        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { status: { in: ['OPEN', 'COMPLETED'] } } })
        );
        expect(options.map((entry) => entry.season)).toEqual([4, 3]);
    });

    it('scopes previous-server options and rankings to the request profile', async () => {
        const cheCaller = appRouter.createCaller(buildContext({ authenticated: false }));
        await expect(cheCaller.ranking.getHallOfFameOptions({ source: 'legacy' })).resolves.toEqual([
            {
                sourceProfile: 'che',
                season: 1,
                scenarios: [{ id: 7, name: 'CHE 이전 시나리오', count: 2 }],
            },
        ]);

        const cheResult = await cheCaller.ranking.getHallOfFame({
            source: 'legacy',
            season: 1,
            scenario: 7,
        });
        expect(cheResult.source).toBe('legacy');
        expect(cheResult.sourceProfile).toBe('che');
        expect(cheResult.sections[0]).toMatchObject({
            title: '명 성',
            entries: [expect.objectContaining({ generalId: 9, name: '과거장수', ownerName: '과거소유자' })],
        });
        expect(JSON.stringify(cheResult)).not.toContain('private-legacy-owner-id');
        const staleCrossProfileInput = {
            source: 'legacy' as const,
            sourceProfile: 'hwe' as const,
            season: 1,
            scenario: 7,
        };
        const staleClientResult = await cheCaller.ranking.getHallOfFame(staleCrossProfileInput);
        expect(staleClientResult.sourceProfile).toBe('che');
        expect(staleClientResult.sections[0]?.entries).toHaveLength(1);

        const hweCaller = appRouter.createCaller(buildContext({ authenticated: false, profileId: 'hwe' }));
        await expect(hweCaller.ranking.getHallOfFameOptions({ source: 'legacy' })).resolves.toEqual([
            {
                sourceProfile: 'hwe',
                season: 1,
                scenarios: [{ id: 7, name: 'HWE 이전 시나리오', count: 2 }],
            },
        ]);
        const hweResult = await hweCaller.ranking.getHallOfFame({ source: 'legacy', season: 1, scenario: 7 });
        expect(hweResult.sourceProfile).toBe('hwe');
        expect(hweResult.sections[0]?.entries).toHaveLength(1);

        const developmentCaller = appRouter.createCaller(
            buildContext({ authenticated: false, profileId: 'development' })
        );
        await expect(developmentCaller.ranking.getHallOfFameOptions({ source: 'legacy' })).resolves.toEqual([]);
        const developmentResult = await developmentCaller.ranking.getHallOfFame({ source: 'legacy', season: 1 });
        expect(developmentResult.sections.every((section) => section.entries.length === 0)).toBe(true);
    });

    it('returns an explicit display name but never exposes the stored account identifier', async () => {
        const result = await appRouter
            .createCaller(buildContext({ authenticated: false, includeOwnerDisplayName: true }))
            .ranking.getHallOfFame({ season: 3 });
        expect(result.sections[0]?.entries[0]?.ownerName).toBe('공개소유자');
        expect(JSON.stringify(result)).not.toContain('private-hall-user-id');

        const redacted = await appRouter
            .createCaller(buildContext({ authenticated: false }))
            .ranking.getHallOfFame({ season: 3 });
        expect(redacted.sections[0]?.entries[0]?.ownerName).toBeNull();
    });

    it('returns the inheritance earned ranking for each completed season', async () => {
        const result = await appRouter
            .createCaller(buildContext({ authenticated: false }))
            .ranking.getHallOfFame({ season: 3 });

        expect(result.sections).toHaveLength(25);
        expect(result.sections.at(-1)).toMatchObject({
            title: '유 산 획 득 량',
            valueType: 'int',
            entries: [expect.objectContaining({ generalId: 1, value: 4321, printValue: '4,321' })],
        });
    });
});
