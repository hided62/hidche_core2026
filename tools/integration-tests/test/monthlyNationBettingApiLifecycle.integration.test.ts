import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { InMemoryFlushStore } from '@sammo-ts/game-api/auth/flushStore.js';
import { RedisAccessTokenStore } from '@sammo-ts/game-api/auth/accessTokenStore.js';
import { InMemoryBattleSimTransport } from '@sammo-ts/game-api/battleSim/inMemoryTransport.js';
import type { GameApiContext } from '@sammo-ts/game-api/context.js';
import { InMemoryTurnDaemonTransport } from '@sammo-ts/game-api/daemon/inMemoryTransport.js';
import { appRouter } from '@sammo-ts/game-api/router.js';
import { createDatabaseTurnHooks } from '@sammo-ts/game-engine/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '@sammo-ts/game-engine/turn/inMemoryWorld.js';
import {
    createFinishNationBettingHandler,
    createOpenNationBettingHandler,
} from '@sammo-ts/game-engine/turn/monthlyNationBettingAction.js';
import { createMonthlyEventHandler } from '@sammo-ts/game-engine/turn/monthlyEventHandler.js';
import type {
    TurnEvent,
    TurnGeneral,
    TurnWorldSnapshot,
    TurnWorldState,
} from '@sammo-ts/game-engine/turn/types.js';
import {
    createGamePostgresConnector,
    type GamePrismaClient,
    type RedisConnector,
} from '@sammo-ts/infra';
import type { City, Nation } from '@sammo-ts/logic';

import { findTurnDifferentialWorkspaceRoot } from '../src/turn-differential/referenceSnapshot.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const workspaceRoot =
    process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const integration = describe.skipIf(!databaseUrl);
const nationIds = [990_091, 990_092] as const;
const cityIds = [990_091, 990_092] as const;
const generalIds = [9_991, 9_992] as const;
const userIds = ['monthly-betting-api-user-1', 'monthly-betting-api-user-2'] as const;
const bettingId = 990_091;
const sourceEventId = 990_091;
const finishEventId = 990_093;

type ReferenceBettingLifecycle = {
    phases: {
        afterOpen: {
            candidateNationIds: number[];
            systemBonus: number;
            finishEventCount: number;
            historyLogs: string[];
        };
        afterBets: {
            bets: Array<{
                generalId: number;
                ownerId: number | null;
                selectionKey: string;
                amount: number;
            }>;
            inheritancePrevious: number[];
            spentRank: number[];
        };
        afterFinish: {
            result: boolean;
            finished: boolean;
            winner: number[];
            inheritancePrevious: number[];
            earnedRank: number[];
            historyLogs: string[];
        };
    };
};

const runReferenceLifecycle = (): ReferenceBettingLifecycle | null => {
    if (process.env.TURN_DIFFERENTIAL_REFERENCE !== '1' || !workspaceRoot) {
        return null;
    }
    const stackDirectory = path.join(workspaceRoot, 'docker_compose_files/reference');
    const runnerScript =
        process.env.MONTHLY_BETTING_LIFECYCLE_RUNNER_SCRIPT ??
        path.join(workspaceRoot, 'ref/sam/hwe/compare/monthly_event_trace.php');
    const fixturePath =
        process.env.MONTHLY_BETTING_LIFECYCLE_FIXTURE ??
        path.join(path.dirname(runnerScript), 'fixtures/monthly_nation_betting_lifecycle.json');
    const stdout = execFileSync('./scripts/run-turn-differential-case.sh', ['-'], {
        cwd: stackDirectory,
        input: fs.readFileSync(fixturePath, 'utf8'),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
            ...process.env,
            COMPOSE_PROJECT_NAME: 'sam-rebuild-reference',
            TURN_DIFFERENTIAL_RUNNER_SCRIPT: runnerScript,
            TURN_DIFFERENTIAL_COMPARE_DIR: path.dirname(runnerScript),
        },
    });
    return JSON.parse(stdout) as ReferenceBettingLifecycle;
};

const buildNation = (id: number, power: number): Nation => ({
    id,
    name: id === nationIds[0] ? '위' : '촉',
    color: id === nationIds[0] ? '#111111' : '#222222',
    capitalCityId: id,
    chiefGeneralId: id,
    gold: id === nationIds[0] ? 1_000 : 3_000,
    rice: id === nationIds[0] ? 2_000 : 4_000,
    power,
    level: 2,
    typeCode: id === nationIds[0] ? 'che_유가' : 'che_병가',
    meta: { tech: id === nationIds[0] ? 100 : 200 },
});

const buildCity = (id: number, nationId: number): City => ({
    id,
    name: id === cityIds[0] ? '허창' : '성도',
    nationId,
    level: 3,
    state: 0,
    population: 1_000,
    populationMax: 2_000,
    agriculture: 1_000,
    agricultureMax: 2_000,
    commerce: 1_000,
    commerceMax: 2_000,
    security: 1_000,
    securityMax: 2_000,
    supplyState: 1,
    frontState: 0,
    defence: 1_000,
    defenceMax: 2_000,
    wall: 1_000,
    wallMax: 2_000,
    meta: { region: 1, trust: 50, trade: 100 },
});

const buildGeneral = (id: number, userId: string, nationId: number): TurnGeneral => ({
    id,
    userId,
    name: id === generalIds[0] ? '장수1' : '장수2',
    nationId,
    cityId: nationId,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 0,
    rice: 0,
    crew: 0,
    crewTypeId: 1_100,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
    bornYear: 170,
    deadYear: 250,
    affinity: 1,
    picture: 'default.jpg',
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    lastTurn: { command: '휴식' },
    turnTime: new Date('0200-01-01T00:00:00.000Z'),
    meta: { killturn: 1_000 },
});

const buildAuth = (index: 0 | 1): GameSessionTokenPayload => ({
    version: 1,
    profile: 'che:2',
    issuedAt: '2026-07-27T00:00:00.000Z',
    expiresAt: '2026-07-28T00:00:00.000Z',
    sessionId: `monthly-betting-api-session-${index + 1}`,
    user: {
        id: userIds[index],
        username: `bettor-${index + 1}`,
        displayName: `Bettor ${index + 1}`,
        roles: ['user'],
    },
    sanctions: {},
});

const event: TurnEvent = {
    id: sourceEventId,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['OpenNationBetting', 1, 100]],
    meta: {},
};

integration('monthly nation betting API lifecycle', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const buildContext = (index: 0 | 1): GameApiContext => {
        const redisClient = {
            get: async () => null,
            set: async () => null,
        };
        return {
            requestId: `monthly-betting-api-${index + 1}`,
            db,
            redis: redisClient as unknown as RedisConnector['client'],
            turnDaemon: new InMemoryTurnDaemonTransport(),
            battleSim: new InMemoryBattleSimTransport(),
            profile: { id: 'che', scenario: '2', name: 'che:2' },
            uploadDir: 'uploads',
            uploadPath: '/uploads',
            uploadPublicUrl: null,
            auth: buildAuth(index),
            accessTokenStore: new RedisAccessTokenStore(redisClient, 'che:2'),
            flushStore: new InMemoryFlushStore(),
            gameTokenSecret: 'test-secret',
        };
    };

    const cleanFixture = async () => {
        await db.inputEvent.deleteMany({ where: { actorUserId: { in: [...userIds] } } });
        await db.event.deleteMany({ where: { id: { in: [sourceEventId, sourceEventId + 1, finishEventId] } } });
        await db.nationBetting.deleteMany({ where: { id: bettingId } });
        await db.rankData.deleteMany({ where: { generalId: { in: [...generalIds] } } });
        await db.inheritanceLog.deleteMany({ where: { userId: { in: [...userIds] } } });
        await db.inheritancePoint.deleteMany({ where: { userId: { in: [...userIds] } } });
        await db.message.deleteMany({ where: { mailbox: { in: [...generalIds] } } });
        await db.logEntry.deleteMany({
            where: {
                OR: [
                    { text: { contains: '천하통일 후보를 점치는' } },
                    { text: { contains: '천통국 예상 내기의 결과' } },
                ],
            },
        });
        await db.diplomacy.deleteMany({
            where: {
                OR: [{ srcNationId: { in: [...nationIds] } }, { destNationId: { in: [...nationIds] } }],
            },
        });
        await db.general.deleteMany({ where: { id: { in: [...generalIds] } } });
        await db.city.deleteMany({ where: { id: { in: [...cityIds] } } });
        await db.nation.deleteMany({ where: { id: { in: [...nationIds] } } });
        await db.worldState.deleteMany({ where: { scenarioCode: 'monthly-nation-betting-api-lifecycle' } });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await cleanFixture();
    });

    afterAll(async () => {
        await cleanFixture();
        await closeDb?.();
    });

    it('opens in the engine, accepts session-owned API bets, and settles in the next monthly event', async () => {
        const reference = runReferenceLifecycle();
        const nations = [buildNation(nationIds[0], 100), buildNation(nationIds[1], 300)];
        const cities = [buildCity(cityIds[0], nationIds[0]), buildCity(cityIds[1], nationIds[1])];
        const generals = [
            buildGeneral(generalIds[0], userIds[0], nationIds[0]),
            buildGeneral(generalIds[1], userIds[1], nationIds[1]),
        ];
        await db.nation.createMany({
            data: nations.map((nation) => ({
                id: nation.id,
                name: nation.name,
                color: nation.color,
                capitalCityId: nation.capitalCityId,
                chiefGeneralId: nation.chiefGeneralId,
                gold: nation.gold,
                rice: nation.rice,
                tech: nation.id === nationIds[0] ? 100 : 200,
                level: nation.level,
                typeCode: nation.typeCode,
                meta: {},
            })),
        });
        await db.city.createMany({
            data: cities.map((city) => ({
                id: city.id,
                name: city.name,
                level: city.level,
                nationId: city.nationId,
                population: city.population,
                populationMax: city.populationMax,
                agriculture: city.agriculture,
                agricultureMax: city.agricultureMax,
                commerce: city.commerce,
                commerceMax: city.commerceMax,
                security: city.security,
                securityMax: city.securityMax,
                trust: 50,
                trade: 100,
                defence: city.defence,
                defenceMax: city.defenceMax,
                wall: city.wall,
                wallMax: city.wallMax,
                region: 1,
                meta: {},
            })),
        });
        await db.general.createMany({
            data: generals.map((general) => ({
                id: general.id,
                userId: general.userId,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                npcState: general.npcState,
                leadership: general.stats.leadership,
                strength: general.stats.strength,
                intel: general.stats.intelligence,
                officerLevel: general.officerLevel,
                turnTime: general.turnTime,
                meta: general.meta,
            })),
        });
        await db.inheritancePoint.createMany({
            data: userIds.map((userId) => ({ userId, key: 'previous', value: 1_000 })),
        });
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-nation-betting-api-lifecycle',
                currentYear: 199,
                currentMonth: 12,
                tickSeconds: 600,
                config: {},
                meta: { lastBettingId: bettingId - 1 },
            },
        });
        const state: TurnWorldState = {
            id: row.id,
            currentYear: 199,
            currentMonth: 12,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-07-27T00:00:00.000Z'),
            meta: { lastBettingId: bettingId - 1 },
        };
        const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
            iconPath: '.',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'default' },
        };
        let world: InMemoryTurnWorld | null = null;
        const open = createOpenNationBettingHandler({ getWorld: () => world });
        const finish = createFinishNationBettingHandler({ getWorld: () => world });
        world = new InMemoryTurnWorld(
            state,
            {
                scenarioConfig,
                map: { id: 'test', name: 'test', cities: [] },
                generals,
                cities,
                nations,
                troops: [],
                diplomacy: [],
                events: [event],
                initialEvents: [],
            },
            {
                schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
                calendarHandler: createMonthlyEventHandler({
                    getWorld: () => world,
                    startYear: 190,
                    actions: new Map([
                        ['OpenNationBetting', open],
                        ['FinishNationBetting', finish],
                    ]),
                }),
            }
        );
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);

        try {
            await world.advanceMonth(new Date('0200-01-01T00:00:00.000Z'));
            await hooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            const opened = await db.nationBetting.findUniqueOrThrow({ where: { id: bettingId } });
            const candidates = Array.isArray(opened.candidates) ? opened.candidates : [];
            const candidateNationIds = candidates.flatMap((candidate) => {
                if (!candidate || typeof candidate !== 'object' || !('aux' in candidate)) {
                    return [];
                }
                const aux = candidate.aux;
                return aux && typeof aux === 'object' && 'nation' in aux && typeof aux.nation === 'number'
                    ? [aux.nation]
                    : [];
            });
            const openHistory = await db.logEntry.findMany({
                where: { text: { contains: '천하통일 후보를 점치는' } },
                orderBy: { id: 'asc' },
                select: { text: true },
            });
            const createdFinishEvent = await db.event.findUniqueOrThrow({
                where: { id: sourceEventId + 1 },
                select: { action: true },
            });
            expect(createdFinishEvent.action).toEqual([
                ['FinishNationBetting', bettingId],
                ['DeleteEvent'],
            ]);
            expect({
                candidateNationIds,
                systemBonus: (
                    await db.nationBet.findFirstOrThrow({
                        where: { bettingId, generalId: 0 },
                        select: { amount: true },
                    })
                ).amount,
                finishEventCount: 1,
                historyLogs: openHistory.map((entry) => entry.text),
            }).toEqual({
                candidateNationIds: [nationIds[1], nationIds[0]],
                systemBonus: reference?.phases.afterOpen.systemBonus ?? 100,
                finishEventCount: reference?.phases.afterOpen.finishEventCount ?? 1,
                historyLogs:
                    reference?.phases.afterOpen.historyLogs ??
                    [
                        '<C>●</>200년 1월:<B><b>【내기】</b></>천하통일 후보를 점치는 <C>내기</>가 진행중입니다! 호사가의 참여를 기다립니다!',
                    ],
            });

            await expect(
                appRouter.createCaller(buildContext(0)).betting.bet({
                    bettingId,
                    bettingType: [1],
                    amount: 100,
                })
            ).resolves.toEqual({ result: true });
            await expect(
                appRouter.createCaller(buildContext(1)).betting.bet({
                    bettingId,
                    bettingType: [0],
                    amount: 100,
                })
            ).resolves.toEqual({ result: true });

            const bets = await db.nationBet.findMany({
                where: { bettingId },
                orderBy: { generalId: 'asc' },
                select: { generalId: true, userId: true, selectionKey: true, amount: true },
            });
            const afterBets = {
                selections: bets.map((bet) => ({ selectionKey: bet.selectionKey, amount: bet.amount })),
                inheritancePrevious: await Promise.all(
                    userIds.map(async (userId) => {
                        const point = await db.inheritancePoint.findUniqueOrThrow({
                            where: { userId_key: { userId, key: 'previous' } },
                        });
                        return point.value;
                    })
                ),
                spentRank: await Promise.all(
                    generalIds.map(async (generalId) => {
                        const rank = await db.rankData.findUniqueOrThrow({
                            where: { generalId_type: { generalId, type: 'inherit_spent_dyn' } },
                        });
                        return rank.value;
                    })
                ),
            };
            expect(afterBets).toEqual({
                selections: (reference?.phases.afterBets.bets ?? [
                    { selectionKey: '[-1]', amount: 100 },
                    { selectionKey: '[1]', amount: 100 },
                    { selectionKey: '[0]', amount: 100 },
                ]).map((bet) => ({ selectionKey: bet.selectionKey, amount: bet.amount })),
                inheritancePrevious: reference?.phases.afterBets.inheritancePrevious ?? [900, 900],
                spentRank: reference?.phases.afterBets.spentRank ?? [100, 100],
            });

            world.updateNation(nationIds[0], { level: 0 });
            expect(world.removeEvent(sourceEventId)).toBe(true);
            expect(
                world.addEvent({
                    id: finishEventId,
                    targetCode: 'month',
                    priority: 1_000,
                    condition: true,
                    action: [['FinishNationBetting', bettingId]],
                    meta: {},
                })
            ).toBe(true);
            await world.advanceMonth(new Date('0200-02-01T00:00:00.000Z'));
            await hooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            const settled = await db.nationBetting.findUniqueOrThrow({ where: { id: bettingId } });
            const finishHistory = await db.logEntry.findMany({
                where: {
                    OR: [
                        { text: { contains: '천하통일 후보를 점치는' } },
                        { text: { contains: '천통국 예상 내기의 결과' } },
                    ],
                },
                orderBy: { id: 'asc' },
                select: { text: true },
            });
            const afterFinish = {
                finished: settled.finished,
                winner: settled.winner,
                inheritancePrevious: await Promise.all(
                    userIds.map(async (userId) => {
                        const point = await db.inheritancePoint.findUniqueOrThrow({
                            where: { userId_key: { userId, key: 'previous' } },
                        });
                        return point.value;
                    })
                ),
                earnedRank: await Promise.all(
                    generalIds.map(async (generalId) => {
                        const rank = await db.rankData.findUnique({
                            where: { generalId_type: { generalId, type: 'inherit_earned_act' } },
                        });
                        return rank?.value ?? 0;
                    })
                ),
                historyLogs: finishHistory.map((entry) => entry.text),
            };
            expect(afterFinish).toEqual({
                finished: reference?.phases.afterFinish.finished ?? true,
                winner: reference?.phases.afterFinish.winner ?? [0],
                inheritancePrevious: reference?.phases.afterFinish.inheritancePrevious ?? [900, 1_200],
                earnedRank: reference?.phases.afterFinish.earnedRank ?? [0, 300],
                historyLogs:
                    reference?.phases.afterFinish.historyLogs ??
                    [
                        '<C>●</>200년 1월:<B><b>【내기】</b></>천하통일 후보를 점치는 <C>내기</>가 진행중입니다! 호사가의 참여를 기다립니다!',
                        '<C>●</>200년 2월:<B><b>【내기】</b></> 200년 1월에 열렸던 천통국 예상 내기의 결과가 나왔습니다!',
                    ],
            });
        } finally {
            await hooks.close();
        }
    });
});
