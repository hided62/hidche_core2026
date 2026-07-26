import { describe, expect, it } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
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

const generalRows = [
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
] as const;

const buildContext = (options?: {
    authenticated?: boolean;
    isUnited?: boolean;
    includeOwnerDisplayName?: boolean;
}): GameApiContext => {
    const db = {
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
                generalRows.filter((general) =>
                    args.where.npcState.gte !== undefined
                        ? general.npcState >= args.where.npcState.gte
                        : general.npcState < (args.where.npcState.lt ?? Number.POSITIVE_INFINITY)
                ),
        },
        rankData: {
            findMany: async () => [
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
            findMany: async () => [
                { season: 3, scenario: 22, scenarioName: '가상모드22' },
                { season: 3, scenario: 22, scenarioName: '가상모드22' },
            ],
        },
        hallOfFame: {
            findMany: async (args: { where: { type: string } }) =>
                args.where.type === 'experience'
                    ? [
                          {
                              generalNo: 1,
                              value: 1200,
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
        profile,
        auth: options?.authenticated === false ? null : auth,
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        redis,
        accessTokenStore: new RedisAccessTokenStore(redis, profile.name),
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
                season: 3,
                scenarios: [{ id: 22, name: '가상모드22', count: 2 }],
            },
        ]);
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
});
