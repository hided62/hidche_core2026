import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { createGamePostgresConnector, type GamePrismaClient, type RedisConnector } from '@sammo-ts/infra';

import type { GameApiContext } from '../src/context.js';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { appRouter } from '../src/router.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const bettingId = 990_071;
const concurrentBettingId = 990_072;
const generalId = 9_971;
const otherGeneralId = 9_972;
const nationId = 990_071;
const otherNationId = 990_072;
const userId = 'nation-betting-router-user';
const otherUserId = 'nation-betting-router-other-user';
const noGeneralUserId = 'nation-betting-router-no-general-user';

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che:2',
    issuedAt: '2026-07-25T00:00:00.000Z',
    expiresAt: '2026-07-26T00:00:00.000Z',
    sessionId: 'nation-betting-router-session',
    user: {
        id: userId,
        username: 'bettor',
        displayName: 'Bettor',
        roles: ['user'],
    },
    sanctions: {},
};

const otherAuth: GameSessionTokenPayload = {
    ...auth,
    sessionId: 'nation-betting-router-other-session',
    user: {
        ...auth.user,
        id: otherUserId,
        username: 'other-bettor',
        displayName: 'Other Bettor',
    },
};

const noGeneralAuth: GameSessionTokenPayload = {
    ...auth,
    sessionId: 'nation-betting-router-no-general-session',
    user: {
        ...auth.user,
        id: noGeneralUserId,
        username: 'no-general',
        displayName: 'No General',
    },
};

integration('nation betting router', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;
    let worldStateId: number;

    const buildContext = (requestId: string, actorAuth: GameSessionTokenPayload | null = auth): GameApiContext => {
        const redisClient = {
            get: async () => null,
            set: async () => null,
        };
        return {
            requestId,
            db,
            redis: redisClient as unknown as RedisConnector['client'],
            turnDaemon: new InMemoryTurnDaemonTransport(),
            battleSim: new InMemoryBattleSimTransport(),
            profile: { id: 'che', scenario: '2', name: 'che:2' },
            uploadDir: 'uploads',
            uploadPath: '/uploads',
            uploadPublicUrl: null,
            auth: actorAuth,
            accessTokenStore: new RedisAccessTokenStore(redisClient, 'che:2'),
            flushStore: new InMemoryFlushStore(),
            gameTokenSecret: 'test-secret',
        };
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.inputEvent.deleteMany({ where: { actorUserId: { in: [userId, otherUserId, noGeneralUserId] } } });
        await db.nationBetting.deleteMany({ where: { id: { in: [bettingId, concurrentBettingId] } } });
        await db.rankData.deleteMany({ where: { generalId: { in: [generalId, otherGeneralId] } } });
        await db.inheritanceLog.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
        await db.inheritancePoint.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
        await db.general.deleteMany({ where: { id: { in: [generalId, otherGeneralId] } } });
        await db.nation.deleteMany({ where: { id: { in: [nationId, otherNationId] } } });

        await db.nation.createMany({
            data: [
                {
                    id: nationId,
                    name: '베팅국',
                    color: '#123456',
                    level: 2,
                },
                {
                    id: otherNationId,
                    name: '다른베팅국',
                    color: '#654321',
                    level: 6,
                },
            ],
        });
        await db.general.createMany({
            data: [
                {
                    id: generalId,
                    userId,
                    name: '베팅장수',
                    nationId,
                    cityId: 1,
                    npcState: 0,
                    officerLevel: 0,
                    turnTime: new Date('0200-01-01T00:00:00.000Z'),
                    meta: {},
                },
                {
                    id: otherGeneralId,
                    userId: otherUserId,
                    name: '다른국가수뇌',
                    nationId: otherNationId,
                    cityId: 1,
                    npcState: 0,
                    officerLevel: 12,
                    turnTime: new Date('0200-01-01T00:00:00.000Z'),
                    meta: {},
                },
            ],
        });
        const world = await db.worldState.create({
            data: {
                scenarioCode: 'nation-betting-router',
                currentYear: 200,
                currentMonth: 1,
                tickSeconds: 600,
                config: {},
                meta: {},
            },
        });
        worldStateId = world.id;
        await db.nationBetting.create({
            data: {
                id: bettingId,
                name: '천통국 예상',
                selectCount: 1,
                requiresInheritancePoint: true,
                openYearMonth: 2_400,
                closeYearMonth: 2_424,
                candidates: [
                    {
                        title: '베팅국',
                        info: '국력: 100<br>장수 수: 1<br>도시 수: 1',
                        isHtml: true,
                        aux: { nation: nationId },
                    },
                ],
            },
        });
        await db.nationBetting.create({
            data: {
                id: concurrentBettingId,
                name: '동시 베팅',
                selectCount: 1,
                requiresInheritancePoint: true,
                openYearMonth: 2_400,
                closeYearMonth: 2_424,
                candidates: [{ title: '베팅국', info: '', isHtml: true, aux: { nation: nationId } }],
            },
        });
        await db.inheritancePoint.createMany({
            data: [
                { userId, key: 'previous', value: 1_000 },
                { userId: otherUserId, key: 'previous', value: 500 },
            ],
        });
    });

    afterAll(async () => {
        await db.inputEvent.deleteMany({ where: { actorUserId: { in: [userId, otherUserId, noGeneralUserId] } } });
        await db.nationBetting.deleteMany({ where: { id: { in: [bettingId, concurrentBettingId] } } });
        await db.rankData.deleteMany({ where: { generalId: { in: [generalId, otherGeneralId] } } });
        await db.inheritanceLog.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
        await db.inheritancePoint.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
        await db.general.deleteMany({ where: { id: { in: [generalId, otherGeneralId] } } });
        await db.nation.deleteMany({ where: { id: { in: [nationId, otherNationId] } } });
        await db.worldState.delete({ where: { id: worldStateId } });
        await closeDb?.();
    });

    it('returns legacy-shaped data and atomically deducts and accumulates a bet', async () => {
        const detailBefore = await appRouter
            .createCaller(buildContext('nation-betting-detail-before'))
            .betting.getDetail({ bettingId });
        expect(detailBefore).toMatchObject({
            result: true,
            bettingInfo: { id: bettingId, selectCnt: 1, reqInheritancePoint: true },
            remainPoint: 1_000,
            year: 200,
            month: 1,
        });

        await expect(
            appRouter.createCaller(buildContext('nation-betting-duplicate')).betting.bet({
                bettingId,
                bettingType: [0, 0],
                amount: 100,
            })
        ).rejects.toMatchObject({ message: '필요한 선택 수를 채우지 못했습니다.' });

        await expect(
            appRouter.createCaller(buildContext('nation-betting-first')).betting.bet({
                bettingId,
                bettingType: [0],
                amount: 100,
            })
        ).resolves.toEqual({ result: true });
        await expect(
            appRouter.createCaller(buildContext('nation-betting-second')).betting.bet({
                bettingId,
                bettingType: [0],
                amount: 50,
            })
        ).resolves.toEqual({ result: true });

        expect(await db.nationBet.findMany({ where: { bettingId } })).toEqual([
            expect.objectContaining({
                generalId,
                userId,
                selection: [0],
                selectionKey: '[0]',
                amount: 150,
            }),
        ]);
        expect(
            await db.inheritancePoint.findUniqueOrThrow({
                where: { userId_key: { userId, key: 'previous' } },
            })
        ).toMatchObject({ value: 850 });
        expect(
            await db.rankData.findUniqueOrThrow({
                where: { generalId_type: { generalId, type: 'inherit_spent_dyn' } },
            })
        ).toMatchObject({ nationId, value: 150 });
        expect(await db.inheritanceLog.count({ where: { userId } })).toBe(2);

        const detailAfter = await appRouter
            .createCaller(buildContext('nation-betting-detail-after'))
            .betting.getDetail({ bettingId });
        expect(detailAfter).toMatchObject({
            bettingDetail: [['[0]', 150]],
            myBetting: [['[0]', 150]],
            remainPoint: 850,
        });
    });

    it('serializes concurrent bets so the cumulative 1,000 point limit cannot be overspent', async () => {
        const results = await Promise.allSettled([
            appRouter.createCaller(buildContext('nation-betting-concurrent-a')).betting.bet({
                bettingId: concurrentBettingId,
                bettingType: [0],
                amount: 600,
            }),
            appRouter.createCaller(buildContext('nation-betting-concurrent-b')).betting.bet({
                bettingId: concurrentBettingId,
                bettingType: [0],
                amount: 600,
            }),
        ]);
        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(
            await db.nationBet.aggregate({ where: { bettingId: concurrentBettingId }, _sum: { amount: true } })
        ).toMatchObject({ _sum: { amount: 600 } });
        expect(
            await db.inheritancePoint.findUniqueOrThrow({
                where: { userId_key: { userId, key: 'previous' } },
            })
        ).toMatchObject({ value: 250 });
    });

    it('requires authentication and an owned player general for every betting operation', async () => {
        await expect(
            appRouter.createCaller(buildContext('nation-betting-anonymous-list', null)).betting.getList({
                req: 'bettingNation',
            })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        await expect(
            appRouter
                .createCaller(buildContext('nation-betting-anonymous-detail', null))
                .betting.getDetail({ bettingId })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        await expect(
            appRouter.createCaller(buildContext('nation-betting-anonymous-bet', null)).betting.bet({
                bettingId,
                bettingType: [0],
                amount: 10,
            })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        await expect(
            appRouter.createCaller(buildContext('nation-betting-no-general-list', noGeneralAuth)).betting.getList({
                req: 'bettingNation',
            })
        ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'General not found' });
        await expect(
            appRouter
                .createCaller(buildContext('nation-betting-no-general-detail', noGeneralAuth))
                .betting.getDetail({ bettingId })
        ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'General not found' });
        await expect(
            appRouter.createCaller(buildContext('nation-betting-no-general-bet', noGeneralAuth)).betting.bet({
                bettingId,
                bettingType: [0],
                amount: 10,
            })
        ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'General not found' });
    });

    it('allows generals across nation and office levels while isolating each session user bet', async () => {
        await expect(
            appRouter.createCaller(buildContext('nation-betting-other-list', otherAuth)).betting.getList({
                req: 'bettingNation',
            })
        ).resolves.toMatchObject({
            result: true,
            bettingList: {
                [bettingId]: { name: '천통국 예상' },
            },
        });
        await expect(
            appRouter.createCaller(buildContext('nation-betting-other-bet', otherAuth)).betting.bet({
                bettingId,
                bettingType: [0],
                amount: 100,
            })
        ).resolves.toEqual({ result: true });

        const [firstUserDetail, otherUserDetail] = await Promise.all([
            appRouter.createCaller(buildContext('nation-betting-first-user-detail')).betting.getDetail({ bettingId }),
            appRouter
                .createCaller(buildContext('nation-betting-other-user-detail', otherAuth))
                .betting.getDetail({ bettingId }),
        ]);
        expect(firstUserDetail.myBetting).toEqual([['[0]', 150]]);
        expect(otherUserDetail.myBetting).toEqual([['[0]', 100]]);
        expect(firstUserDetail.bettingDetail).toEqual([['[0]', 250]]);
        expect(otherUserDetail.bettingDetail).toEqual([['[0]', 250]]);

        expect(
            await db.nationBet.findUniqueOrThrow({
                where: {
                    bettingId_userId_selectionKey: {
                        bettingId,
                        userId: otherUserId,
                        selectionKey: '[0]',
                    },
                },
            })
        ).toMatchObject({
            generalId: otherGeneralId,
            userId: otherUserId,
            amount: 100,
        });
        expect(
            await db.inheritancePoint.findUniqueOrThrow({
                where: { userId_key: { userId: otherUserId, key: 'previous' } },
            })
        ).toMatchObject({ value: 400 });
        expect(
            await db.rankData.findUniqueOrThrow({
                where: { generalId_type: { generalId: otherGeneralId, type: 'inherit_spent_dyn' } },
            })
        ).toMatchObject({ nationId: otherNationId, value: 100 });
    });
});
