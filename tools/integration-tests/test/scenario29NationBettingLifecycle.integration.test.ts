import { afterEach, describe, expect, it } from 'vitest';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { RedisAccessTokenStore } from '@sammo-ts/game-api/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '@sammo-ts/game-api/auth/flushStore.js';
import { InMemoryBattleSimTransport } from '@sammo-ts/game-api/battleSim/inMemoryTransport.js';
import type { GameApiContext } from '@sammo-ts/game-api/context.js';
import { InMemoryTurnDaemonTransport } from '@sammo-ts/game-api/daemon/inMemoryTransport.js';
import { appRouter } from '@sammo-ts/game-api/router.js';
import { createTurnDaemonRuntime, seedScenarioToDatabase } from '@sammo-ts/game-engine';
import { createFinishNationBettingHandler } from '@sammo-ts/game-engine/turn/monthlyNationBettingAction.js';
import { createMonthlyEventHandler } from '@sammo-ts/game-engine/turn/monthlyEventHandler.js';
import {
    createGamePostgresConnector,
    type RedisConnector,
} from '@sammo-ts/infra';

const databaseUrl = process.env.SCENARIO_LIFECYCLE_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const scenarioId = 2900;
const userIds = ['scenario29-betting-winner', 'scenario29-betting-loser'] as const;
const openedMessage = '새로운 천통국 내기가 열렸습니다. 천통국 베팅란을 확인해주세요.';

type TurnDaemonRuntime = Awaited<ReturnType<typeof createTurnDaemonRuntime>>;

const buildAuth = (index: 0 | 1): GameSessionTokenPayload => ({
    version: 1,
    profile: `che:${scenarioId}`,
    issuedAt: '2026-08-15T00:00:00.000Z',
    expiresAt: '2026-08-16T00:00:00.000Z',
    sessionId: `scenario29-betting-session-${index + 1}`,
    user: {
        id: userIds[index],
        username: `scenario29-bettor-${index + 1}`,
        displayName: `시나리오29 베팅유저 ${index + 1}`,
        roles: ['user'],
    },
    sanctions: {},
});

const readMessageText = (value: unknown): string | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('text' in value)) {
        return null;
    }
    return typeof value.text === 'string' ? value.text : null;
};

integration('scenario 29 nation betting lifecycle', () => {
    let runtime: TurnDaemonRuntime | null = null;
    let closeDb: (() => Promise<void>) | null = null;

    afterEach(async () => {
        await runtime?.close();
        runtime = null;
        await closeDb?.();
        closeDb = null;
    });

    it('starts scenario 2900, announces and accepts nation betting, then settles the winning user', async () => {
        let generalIds: [number, number] | null = null;
        await seedScenarioToDatabase({
            scenarioId,
            databaseUrl: databaseUrl!,
            now: new Date('2026-08-15T00:00:00.000Z'),
            gameClockMode: 'manual',
            installOptions: {
                turnTermMinutes: 120,
                sync: false,
                tournamentTrig: false,
            },
            onBeforeCommit: async (prisma) => {
                const generals = await prisma.general.findMany({
                    where: { nationId: { gt: 0 } },
                    orderBy: { id: 'asc' },
                    take: 2,
                    select: { id: true },
                });
                if (generals.length !== 2 || !generals[0] || !generals[1]) {
                    throw new Error('Scenario 2900 must seed at least two bettable generals.');
                }
                generalIds = [generals[0].id, generals[1].id];
                await Promise.all(
                    generalIds.map((generalId, index) =>
                        prisma.general.update({
                            where: { id: generalId },
                            data: { userId: userIds[index], npcState: 0 },
                        })
                    )
                );
                await Promise.all(
                    userIds.map((userId) =>
                        prisma.inheritancePoint.upsert({
                            where: { userId_key: { userId, key: 'previous' } },
                            create: { userId, key: 'previous', value: 1_000 },
                            update: { value: 1_000 },
                        })
                    )
                );
            },
        });
        if (!generalIds) {
            throw new Error('Scenario 2900 bettor fixtures were not created.');
        }

        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        const db = connector.prisma;
        closeDb = () => connector.disconnect();

        runtime = await createTurnDaemonRuntime({
            profile: 'che',
            databaseUrl: databaseUrl!,
            gameClockMode: 'manual',
            enableLeaseHeartbeat: false,
            leaseDurationMs: 300_000,
            exclusiveFastForward: true,
        });

        const buildContext = (index: 0 | 1): GameApiContext => {
            const redisClient = {
                get: async () => null,
                set: async () => null,
            };
            return {
                requestId: `scenario29-betting-${index + 1}`,
                db,
                redis: redisClient as unknown as RedisConnector['client'],
                turnDaemon: new InMemoryTurnDaemonTransport(),
                battleSim: new InMemoryBattleSimTransport(),
                profile: { id: 'che', scenario: String(scenarioId), name: `che:${scenarioId}` },
                uploadDir: 'uploads',
                uploadPath: '/uploads',
                uploadPublicUrl: null,
                auth: buildAuth(index),
                accessTokenStore: new RedisAccessTokenStore(redisClient, `che:${scenarioId}`),
                flushStore: new InMemoryFlushStore(),
                gameTokenSecret: 'scenario29-betting-test-secret',
            };
        };

        expect(runtime.world.getState()).toMatchObject({ currentYear: 2025, currentMonth: 1 });
        expect(runtime.world.listEvents('month').map((event) => event.action)).toContainEqual([
            ['OpenNationBetting', 1, 2000],
            ['DeleteEvent'],
        ]);

        for (let month = 0; month < 12; month += 1) {
            const state = runtime.world.getState();
            const turnTime = new Date(state.lastTurnTime.getTime() + state.tickSeconds * 1_000);
            await runtime.world.advanceMonth(turnTime);
            await runtime.hooks?.flushChanges?.({
                lastTurnTime: runtime.world.getState().lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });
        }

        expect(runtime.world.getState()).toMatchObject({ currentYear: 2026, currentMonth: 1 });
        const betting = await db.nationBetting.findFirstOrThrow({
            where: { name: '천통국 예상', finished: false },
            orderBy: { id: 'desc' },
        });
        expect(betting).toMatchObject({ selectCount: 1, openYearMonth: 2026 * 12, closeYearMonth: 2028 * 12 });
        expect(
            await db.nationBet.findFirstOrThrow({
                where: { bettingId: betting.id, generalId: 0 },
                select: { selectionKey: true, amount: true },
            })
        ).toEqual({ selectionKey: '[-1]', amount: 2000 });

        const historyLogs = await db.logEntry.findMany({
            where: { text: { contains: '천하통일 후보를 점치는' } },
            orderBy: { id: 'asc' },
            select: { text: true },
        });
        expect(historyLogs.map((entry) => entry.text)).toContain(
            '<C>●</>2026년 1월:<B><b>【내기】</b></>천하통일 후보를 점치는 <C>내기</>가 진행중입니다! 호사가의 참여를 기다립니다!'
        );
        const messages = await db.message.findMany({
            where: { mailbox: { in: generalIds } },
            orderBy: { id: 'asc' },
            select: { mailbox: true, message: true },
        });
        expect(
            messages
                .filter((message) => readMessageText(message.message) === openedMessage)
                .map((message) => message.mailbox)
                .sort((left, right) => left - right)
        ).toEqual([...generalIds].sort((left, right) => left - right));

        const candidates = Array.isArray(betting.candidates) ? betting.candidates : [];
        const candidateNationIds = candidates.flatMap((candidate) => {
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || !('aux' in candidate)) {
                return [];
            }
            const aux = candidate.aux;
            if (!aux || typeof aux !== 'object' || Array.isArray(aux) || !('nation' in aux)) {
                return [];
            }
            return typeof aux.nation === 'number' ? [aux.nation] : [];
        });
        expect(candidateNationIds.length).toBeGreaterThan(1);
        const winnerNationId = candidateNationIds[0]!;
        const loserSelection = 1;

        await expect(
            appRouter.createCaller(buildContext(0)).betting.bet({
                bettingId: betting.id,
                bettingType: [0],
                amount: 100,
            })
        ).resolves.toEqual({ result: true });
        await expect(
            appRouter.createCaller(buildContext(1)).betting.bet({
                bettingId: betting.id,
                bettingType: [loserSelection],
                amount: 100,
            })
        ).resolves.toEqual({ result: true });
        expect(
            await Promise.all(
                userIds.map(async (userId) =>
                    (
                        await db.inheritancePoint.findUniqueOrThrow({
                            where: { userId_key: { userId, key: 'previous' } },
                        })
                    ).value
                )
            )
        ).toEqual([900, 900]);

        for (const nation of runtime.world.listNations()) {
            if (nation.id > 0 && nation.id !== winnerNationId) {
                runtime.world.removeNation(nation.id);
            }
        }
        const finishHandler = createFinishNationBettingHandler({ getWorld: () => runtime?.world ?? null });
        const eventHandler = createMonthlyEventHandler({
            getWorld: () => runtime?.world ?? null,
            startYear: 2025,
            actions: new Map([['FinishNationBetting', finishHandler]]),
        });
        const finishState = runtime.world.getState();
        await eventHandler.dispatchTarget('destroy_nation', {
            previousYear: finishState.currentYear,
            previousMonth: finishState.currentMonth,
            currentYear: finishState.currentYear,
            currentMonth: finishState.currentMonth,
            turnTime: new Date(finishState.lastTurnTime.getTime() + finishState.tickSeconds * 1_000),
        });
        await runtime.hooks?.flushChanges?.({
            lastTurnTime: runtime.world.getState().lastTurnTime.toISOString(),
            processedGenerals: 0,
            processedTurns: 0,
            durationMs: 0,
            partial: false,
        });

        expect(await db.nationBetting.findUniqueOrThrow({ where: { id: betting.id } })).toMatchObject({
            finished: true,
            winner: [0],
        });
        expect(
            await Promise.all(
                userIds.map(async (userId) =>
                    (
                        await db.inheritancePoint.findUniqueOrThrow({
                            where: { userId_key: { userId, key: 'previous' } },
                        })
                    ).value
                )
            )
        ).toEqual([3_100, 900]);
        expect(
            await db.rankData.findUniqueOrThrow({
                where: { generalId_type: { generalId: generalIds[0], type: 'inherit_earned_act' } },
                select: { value: true },
            })
        ).toEqual({ value: 2_200 });
        expect(
            await db.logEntry.findFirst({
                where: { text: { contains: '천통국 예상 내기의 결과가 나왔습니다' } },
                select: { text: true },
            })
        ).not.toBeNull();
    }, 120_000);
});
