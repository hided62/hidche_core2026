import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SystemClock } from '@sammo-ts/common';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import {
    createDatabaseTurnHooks,
    DatabaseTurnDaemonCommandQueue,
    EngineStateManager,
    InMemoryTurnStateStore,
    InMemoryTurnWorld,
    loadTurnWorldFromDatabase,
    TurnDaemonLifecycle,
    type TurnGeneral,
    type TurnWorldSnapshot,
    type TurnWorldState,
} from '@sammo-ts/game-engine';
import { createTurnDaemonCommandHandler } from '@sammo-ts/game-engine/turn/worldCommandHandler.js';
import {
    createGamePostgresConnector,
    type GamePrisma,
    type GamePrismaClient,
    type RedisConnector,
} from '@sammo-ts/infra';
import type { MapDefinition, ScenarioConfig, ScenarioMeta, TurnSchedule } from '@sammo-ts/logic';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import type { GameApiContext } from '../src/context.js';
import { DatabaseTurnDaemonTransport } from '../src/daemon/databaseTransport.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { appRouter } from '../src/router.js';

const databaseUrl = process.env.IMMEDIATE_ACTION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const worldId = 992_320;
const actorId = 7_320;
const targetId = 7_321;
const actorNationId = 7_322;
const targetNationId = 7_323;
const actorUserId = 'inherit-owner-message-actor';
const targetUserId = 'inherit-owner-message-target';
const requestId = 'integration:inherit-owner-message:success';
const engineRequestId = `${requestId}:inherit.checkOwner:engine:0:inheritanceAction`;
const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
const scenarioConfig: ScenarioConfig = {
    stat: { total: 200, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
    iconPath: '.',
    map: {},
    const: { inheritCheckOwnerPoint: 1_000 },
    environment: { mapName: 'che', unitSet: 'che' },
};
const scenarioMeta: ScenarioMeta = {
    title: '소유자 확인 통합',
    startYear: 200,
    life: null,
    fiction: null,
    history: [],
    ignoreDefaultEvents: false,
};
const map: MapDefinition = { id: 'inherit-owner-message', name: scenarioMeta.title, cities: [] };
const state: TurnWorldState = {
    id: worldId,
    currentYear: 200,
    currentMonth: 4,
    tickSeconds: 600,
    lastTurnTime: new Date('2026-08-19T00:00:00.000Z'),
    clockBaseTime: new Date('2026-08-19T00:00:00.000Z'),
    clockTick: 0,
    clockMode: 'manual',
    clockWallAnchor: new Date('2026-08-19T00:00:00.000Z'),
    lastTurnTick: 0,
    clockPhase: 'MANUAL',
    clockRevision: 1,
    deadlineGeneration: 1,
    meta: { hiddenSeed: 'inherit-owner-message', isunited: 0, scenarioMeta },
};

const general = (overrides: Partial<TurnGeneral>): TurnGeneral => ({
    id: actorId,
    userId: actorUserId,
    name: '확인장수',
    nationId: actorNationId,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 45, intelligence: 85 },
    turnTime: new Date('2026-08-19T00:10:00.000Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24, inherit_spent_dyn: 0 },
    inheritancePoints: { previous: 1_500 },
    penalty: {},
    officerLevel: 1,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
    ...overrides,
});
const actor = general({});
const target = general({
    id: targetId,
    userId: targetUserId,
    name: '피확인장수',
    nationId: targetNationId,
    meta: { killturn: 24, owner_name: '피확인 계정' },
    inheritancePoints: { previous: 0 },
});
const nation = (id: number, name: string, chiefGeneralId: number) => ({
    id,
    name,
    color: id === actorNationId ? '#123456' : '#654321',
    capitalCityId: null,
    chiefGeneralId,
    gold: 0,
    rice: 0,
    power: 0,
    level: 1,
    typeCode: 'che_def',
    meta: {},
});
const actorNation = nation(actorNationId, '확인국', actorId);
const targetNation = nation(targetNationId, '피확인국', targetId);
const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che:inherit-owner-message',
    issuedAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-20T00:00:00.000Z',
    sessionId: 'inherit-owner-message-session',
    user: { id: actorUserId, username: actorUserId, displayName: '확인자 계정', roles: ['user'] },
    sanctions: {},
};

const toCreate = (entry: TurnGeneral): GamePrisma.GeneralCreateManyInput => ({
    id: entry.id,
    userId: entry.userId,
    name: entry.name,
    nationId: entry.nationId,
    cityId: entry.cityId,
    npcState: entry.npcState,
    leadership: entry.stats.leadership,
    strength: entry.stats.strength,
    intel: entry.stats.intelligence,
    turnTime: entry.turnTime,
    meta: entry.meta as GamePrisma.InputJsonValue,
    penalty: entry.penalty as GamePrisma.InputJsonValue,
});

integration('inherit owner lookup private messages', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const schema = new URL(databaseUrl!).searchParams.get('schema');
        if (!schema?.endsWith('immediate_action_integration')) throw new Error(`Unsafe schema: ${schema}`);
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.inputEvent.deleteMany({ where: { requestId: engineRequestId } });
        await db.message.deleteMany({ where: { mailbox: { in: [actorId, targetId] } } });
        await db.inheritanceLog.deleteMany({ where: { userId: actorUserId } });
        await db.inheritancePoint.deleteMany({ where: { userId: { in: [actorUserId, targetUserId] } } });
        await db.rankData.deleteMany({ where: { generalId: { in: [actorId, targetId] } } });
        await db.general.deleteMany({ where: { id: { in: [actorId, targetId] } } });
        await db.nation.deleteMany({ where: { id: { in: [actorNationId, targetNationId] } } });
        await db.worldState.deleteMany({ where: { id: worldId } });
        await db.worldState.create({
            data: {
                id: worldId,
                scenarioCode: 'inherit-owner-message',
                currentYear: 200,
                currentMonth: 4,
                tickSeconds: 600,
                clockBaseTime: state.clockBaseTime,
                clockTick: BigInt(state.clockTick ?? 0),
                clockMode: state.clockMode ?? 'manual',
                clockWallAnchor: state.clockWallAnchor,
                lastTurnTick: BigInt(state.lastTurnTick ?? 0),
                clockPhase: state.clockPhase ?? 'MANUAL',
                clockRevision: BigInt(state.clockRevision ?? 1),
                deadlineGeneration: BigInt(state.deadlineGeneration ?? 1),
                config: JSON.parse(JSON.stringify(scenarioConfig)) as GamePrisma.InputJsonValue,
                meta: state.meta as GamePrisma.InputJsonValue,
            },
        });
        await db.nation.createMany({
            data: [
                { id: actorNationId, name: actorNation.name, color: actorNation.color, level: 1 },
                { id: targetNationId, name: targetNation.name, color: targetNation.color, level: 1 },
            ],
        });
        await db.general.createMany({ data: [actor, target].map(toCreate) });
        await db.inheritancePoint.create({ data: { userId: actorUserId, key: 'previous', value: 1_500 } });
        await db.rankData.create({
            data: { generalId: actorId, nationId: actorNationId, type: 'inherit_spent_dyn', value: 0 },
        });
    });

    afterAll(async () => {
        if (db) {
            await db.inputEvent.deleteMany({ where: { requestId: engineRequestId } });
            await db.message.deleteMany({ where: { mailbox: { in: [actorId, targetId] } } });
            await db.inheritanceLog.deleteMany({ where: { userId: actorUserId } });
            await db.inheritancePoint.deleteMany({ where: { userId: { in: [actorUserId, targetUserId] } } });
            await db.rankData.deleteMany({ where: { generalId: { in: [actorId, targetId] } } });
            await db.general.deleteMany({ where: { id: { in: [actorId, targetId] } } });
            await db.nation.deleteMany({ where: { id: { in: [actorNationId, targetNationId] } } });
            await db.worldState.deleteMany({ where: { id: worldId } });
        }
        await closeDb?.();
    });

    it('commits once and returns the durable result without double charging on the same API retry', async () => {
        const snapshot: TurnWorldSnapshot = {
            generals: [actor, target],
            cities: [],
            nations: [actorNation, targetNation],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            scenarioConfig,
            scenarioMeta,
            map,
        };
        const world = new InMemoryTurnWorld(state, snapshot, { schedule });
        const queue = new DatabaseTurnDaemonCommandQueue(db);
        await queue.initialize();
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        const stateManager = new EngineStateManager();
        stateManager.register('world', {
            capture: () => world.captureState(),
            restore: (value) => world.restoreState(value),
        });
        const lifecycle = new TurnDaemonLifecycle(
            {
                clock: new SystemClock(),
                controlQueue: queue,
                commandResponder: queue,
                getNextTickTime: () => new Date(Date.now() + 3_600_000),
                stateStore: new InMemoryTurnStateStore(world),
                processor: {
                    run: async () => {
                        throw new Error('scheduled turn must not run in inheritance API integration');
                    },
                },
                commandHandler: createTurnDaemonCommandHandler({ world }),
                hooks: hooks.hooks,
                stateManager,
            },
            { profile: 'inherit-owner-message', defaultBudget: { budgetMs: 100, maxGenerals: 1, catchUpCap: 1 } }
        );
        const redisClient = { get: async () => null, set: async () => null };
        const context: GameApiContext = {
            requestId,
            db,
            redis: redisClient as unknown as RedisConnector['client'],
            turnDaemon: new DatabaseTurnDaemonTransport(db, 10_000),
            battleSim: new InMemoryBattleSimTransport(),
            profile: { id: 'che', scenario: 'inherit-owner-message', name: 'che:inherit-owner-message' },
            uploadDir: 'uploads',
            uploadPath: '/uploads',
            uploadPublicUrl: null,
            auth,
            accessTokenStore: new RedisAccessTokenStore(redisClient, 'che:inherit-owner-message'),
            flushStore: new InMemoryFlushStore(),
            gameTokenSecret: 'test-secret',
        };

        let loop: Promise<void> | undefined;
        try {
            loop = lifecycle.start();
            const caller = appRouter.createCaller(context);
            const expected = { ok: true, ownerName: '피확인 계정', targetName: '피확인장수' };
            await expect(caller.inherit.checkOwner({ targetGeneralId: targetId })).resolves.toEqual(expected);
            await expect(caller.inherit.checkOwner({ targetGeneralId: targetId })).resolves.toEqual(expected);
        } finally {
            await lifecycle.stop('inherit owner integration finished');
            await loop;
            await hooks.close();
        }

        await expect(
            db.inheritancePoint.findUniqueOrThrow({ where: { userId_key: { userId: actorUserId, key: 'previous' } } })
        ).resolves.toMatchObject({ value: 500 });
        await expect(
            db.rankData.findUniqueOrThrow({
                where: { generalId_type: { generalId: actorId, type: 'inherit_spent_dyn' } },
            })
        ).resolves.toMatchObject({ value: 1_000 });
        await expect(db.inheritanceLog.count({ where: { userId: actorUserId } })).resolves.toBe(1);
        const messages = await db.message.findMany({
            where: { mailbox: { in: [actorId, targetId] } },
            orderBy: { id: 'asc' },
            select: { mailbox: true, message: true },
        });
        expect(messages.map(({ mailbox, message }) => [mailbox, (message as { text: string }).text])).toEqual([
            [actorId, '피확인장수의 소유자는 피확인 계정 입니다.'],
            [targetId, '소유자명이 누군가에 의해 확인되었습니다.'],
        ]);
        await expect(db.inputEvent.findMany({ where: { requestId: engineRequestId } })).resolves.toEqual([
            expect.objectContaining({ status: 'SUCCEEDED', attempts: 1, actorUserId }),
        ]);
        const reloaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        expect(reloaded.snapshot.generals.find((entry) => entry.id === actorId)).toMatchObject({
            meta: { inherit_spent_dyn: 1_000 },
            inheritancePoints: { previous: 500 },
        });
    }, 30_000);
});
