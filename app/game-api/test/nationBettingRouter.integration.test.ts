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
const nationId = 990_071;
const userId = 'nation-betting-router-user';

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

integration('nation betting router', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;
    let worldStateId: number;

    const buildContext = (requestId: string): GameApiContext => {
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
            auth,
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
        await db.inputEvent.deleteMany({ where: { actorUserId: userId } });
        await db.nationBetting.deleteMany({ where: { id: { in: [bettingId, concurrentBettingId] } } });
        await db.rankData.deleteMany({ where: { generalId } });
        await db.inheritanceLog.deleteMany({ where: { userId } });
        await db.inheritancePoint.deleteMany({ where: { userId } });
        await db.general.deleteMany({ where: { id: generalId } });
        await db.nation.deleteMany({ where: { id: nationId } });

        await db.nation.create({
            data: {
                id: nationId,
                name: '베팅국',
                color: '#123456',
                level: 2,
            },
        });
        await db.general.create({
            data: {
                id: generalId,
                userId,
                name: '베팅장수',
                nationId,
                cityId: 1,
                npcState: 0,
                turnTime: new Date('0200-01-01T00:00:00.000Z'),
                meta: {},
            },
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
        await db.inheritancePoint.create({
            data: { userId, key: 'previous', value: 1_000 },
        });
    });

    afterAll(async () => {
        await db.inputEvent.deleteMany({ where: { actorUserId: userId } });
        await db.nationBetting.deleteMany({ where: { id: { in: [bettingId, concurrentBettingId] } } });
        await db.rankData.deleteMany({ where: { generalId } });
        await db.inheritanceLog.deleteMany({ where: { userId } });
        await db.inheritancePoint.deleteMany({ where: { userId } });
        await db.general.deleteMany({ where: { id: generalId } });
        await db.nation.deleteMany({ where: { id: nationId } });
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
        expect(await db.nationBet.aggregate({ where: { bettingId: concurrentBettingId }, _sum: { amount: true } }))
            .toMatchObject({ _sum: { amount: 600 } });
        expect(
            await db.inheritancePoint.findUniqueOrThrow({
                where: { userId_key: { userId, key: 'previous' } },
            })
        ).toMatchObject({ value: 250 });
    });
});
