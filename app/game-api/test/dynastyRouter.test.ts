import { describe, expect, it } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import type { DatabaseClient, GameApiContext, GameProfile } from '../src/context.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { appRouter } from '../src/router.js';

const profile: GameProfile = {
    id: 'che',
    scenario: 'default',
    name: 'che:default',
};

const emperor = {
    id: 7,
    serverId: 'hwe_260725_fixture',
    phase: '훼2기',
    nationCount: '3 / 8',
    nationName: '촉, 위, 오',
    nationHist: '병가(2), 유가(1)',
    genCount: '7 / 21',
    personalHist: '의리(4)',
    specialHist: '상재(2)',
    name: '촉',
    type: 'che_병가',
    color: '#FF0000',
    year: 215,
    month: 4,
    power: 34434,
    gennum: 7,
    citynum: 8,
    pop: '12345 / 15000',
    poprate: '82.3 %',
    gold: 50000,
    rice: 60000,
    l12name: '유비',
    l12pic: '',
    l11name: '제갈량',
    l11pic: '',
    l10name: '관우',
    l10pic: '',
    l9name: '방통',
    l9pic: '',
    l8name: '장비',
    l8pic: '',
    l7name: '법정',
    l7pic: '',
    l6name: '조운',
    l6pic: '',
    l5name: '마량',
    l5pic: '',
    tiger: '관우【10】',
    eagle: '방통【7】',
    gen: '유비, 제갈량',
    history: ['<C>●</>촉이 천하를 통일'],
    aux: { winnerNationId: 1, privateNote: 'not-returned' },
};

const oldNation = {
    id: 3,
    serverId: emperor.serverId,
    nation: 1,
    data: {
        nation: 1,
        name: '촉',
        color: '#FF0000',
        type: 'che_병가',
        level: 7,
        tech: 4000,
        power: 34434,
        maxCrew: 120000,
        maxCities: ['성도', '한중'],
        generals: [11, 12],
        history: ['<Y>유비</>가 황제로 즉위'],
        owner: 'not-returned',
    },
    date: new Date('2026-07-25T12:00:00.000Z'),
};

const authFor = (userId: string, roles: string[] = []): GameSessionTokenPayload => ({
    version: 1,
    profile: profile.name,
    issuedAt: '2026-07-25T00:00:00.000Z',
    expiresAt: '2026-07-26T00:00:00.000Z',
    sessionId: `session-${userId}`,
    user: {
        id: userId,
        username: userId,
        displayName: userId,
        roles,
    },
    sanctions: {},
});

const buildContext = (auth: GameSessionTokenPayload | null): GameApiContext => {
    const db = {
        worldState: {
            findFirst: async () => ({ currentYear: 220, currentMonth: 1 }),
        },
        emperor: {
            findMany: async () => [emperor],
            findUnique: async ({ where }: { where: { id: number } }) => (where.id === emperor.id ? emperor : null),
        },
        oldNation: {
            findMany: async ({ where }: { where: { serverId: string } }) =>
                where.serverId === emperor.serverId ? [oldNation] : [],
        },
        oldGeneral: {
            findMany: async () => [
                { generalNo: 11, name: '유비', lastYearMonth: 21504 },
                { generalNo: 12, name: '제갈량', lastYearMonth: 21504 },
            ],
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
        auth,
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        redis,
        accessTokenStore: new RedisAccessTokenStore(redis, profile.name),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
};

describe('dynasty public read model', () => {
    it('returns the current row and the complete legacy officer summary', async () => {
        const result = await appRouter.createCaller(buildContext(null)).dynasty.getList();

        expect(result.current).toEqual({ year: 220, month: 1 });
        expect(result.entries).toEqual([
            expect.objectContaining({
                id: 7,
                serverId: 'hwe_260725_fixture',
                phase: '훼2기',
                name: '촉',
                l12name: '유비',
                l11name: '제갈량',
                l10name: '관우',
                l9name: '방통',
                l8name: '장비',
                l7name: '법정',
                l6name: '조운',
                l5name: '마량',
            }),
        ]);
    });

    it('exposes the same public DTO to anonymous, general owners and admins', async () => {
        const anonymous = appRouter.createCaller(buildContext(null));
        const owner = appRouter.createCaller(buildContext(authFor('owner-a')));
        const otherOwner = appRouter.createCaller(buildContext(authFor('owner-b')));
        const admin = appRouter.createCaller(buildContext(authFor('admin', ['admin'])));

        const [anonymousList, ownerList, otherOwnerList, adminList] = await Promise.all([
            anonymous.dynasty.getList(),
            owner.dynasty.getList(),
            otherOwner.dynasty.getList(),
            admin.dynasty.getList(),
        ]);
        expect(ownerList).toEqual(anonymousList);
        expect(otherOwnerList).toEqual(anonymousList);
        expect(adminList).toEqual(anonymousList);

        const [anonymousDetail, ownerDetail, otherOwnerDetail, adminDetail] = await Promise.all([
            anonymous.dynasty.getDetail({ emperorId: emperor.id }),
            owner.dynasty.getDetail({ emperorId: emperor.id }),
            otherOwner.dynasty.getDetail({ emperorId: emperor.id }),
            admin.dynasty.getDetail({ emperorId: emperor.id }),
        ]);
        expect(ownerDetail).toEqual(anonymousDetail);
        expect(otherOwnerDetail).toEqual(anonymousDetail);
        expect(adminDetail).toEqual(anonymousDetail);
    });

    it('returns only the legacy public archive fields and resolves general names', async () => {
        const result = await appRouter.createCaller(buildContext(authFor('owner-a'))).dynasty.getDetail({
            emperorId: emperor.id,
        });

        expect(result.emperor).toEqual(
            expect.objectContaining({
                personalHist: '의리(4)',
                specialHist: '상재(2)',
                tiger: '관우【10】',
                eagle: '방통【7】',
                history: ['<C>●</>촉이 천하를 통일'],
            })
        );
        expect(result.nations).toEqual([
            expect.objectContaining({
                name: '촉',
                type: 'che_병가',
                typeName: '병가',
                levelName: '황제',
                maxPower: 34434,
                generalsFull: [
                    { generalNo: 11, name: '유비', lastYearMonth: 21504 },
                    { generalNo: 12, name: '제갈량', lastYearMonth: 21504 },
                ],
            }),
        ]);
        expect(JSON.stringify(result)).not.toContain('privateNote');
        expect(JSON.stringify(result)).not.toContain('not-returned');
        expect(JSON.stringify(result)).not.toContain('"owner"');
        expect(JSON.stringify(result)).not.toContain('"data"');
    });

    it('rejects invalid and missing record identifiers without querying another scope', async () => {
        const caller = appRouter.createCaller(buildContext(null));

        await expect(caller.dynasty.getDetail({ emperorId: 0 })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
        await expect(caller.dynasty.getDetail({ emperorId: 999 })).rejects.toMatchObject({
            code: 'NOT_FOUND',
        });
    });
});
