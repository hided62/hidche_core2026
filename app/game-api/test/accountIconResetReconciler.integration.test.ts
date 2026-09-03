import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { SystemClock } from '@sammo-ts/common';
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
import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';
import type { MapDefinition, ScenarioConfig, ScenarioMeta, TurnSchedule } from '@sammo-ts/logic';

import { DatabaseTurnDaemonTransport } from '../src/daemon/databaseTransport.js';
import { AccountIconResetReconciler } from '../src/services/accountIconResetReconciler.js';

const databaseUrl = process.env.IMMEDIATE_ACTION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const generalId = 991_744;
const userId = 'account-icon-reset-reconcile-user';
const revision = '2026-07-31T10:00:00.001Z';
const requestId = `general:adjustIcon:${userId}:${revision}`;
const retryRequestId = `${requestId}:retry:1`;
const lifecycleGeneralId = 991_745;
const lifecycleWorldId = 991_745;
const lifecycleUserId = 'account-icon-reset-lifecycle-user';
const lifecycleRevision = '2026-07-31T10:20:00.001Z';
const lifecycleRequestId = `general:adjustIcon:${lifecycleUserId}:${lifecycleRevision}`;
const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };

const scenarioConfig: ScenarioConfig = {
    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 65 },
    iconPath: '',
    map: {},
    const: {},
    environment: { mapName: 'che', unitSet: 'che' },
};
const scenarioMeta: ScenarioMeta = {
    title: '계정 아이콘 reset lifecycle 통합',
    startYear: 190,
    life: null,
    fiction: null,
    history: [],
    ignoreDefaultEvents: false,
};
const map: MapDefinition = { id: 'account-icon-reset-lifecycle', name: scenarioMeta.title, cities: [] };
const lifecycleState: TurnWorldState = {
    id: lifecycleWorldId,
    currentYear: 190,
    currentMonth: 1,
    tickSeconds: 600,
    lastTurnTime: new Date('2026-07-31T10:00:00.000Z'),
    clockBaseTime: new Date('2026-07-31T10:00:00.000Z'),
    clockTick: 0,
    clockMode: 'manual',
    clockWallAnchor: new Date('2026-07-31T10:00:00.000Z'),
    lastTurnTick: 0,
    clockPhase: 'MANUAL',
    clockRevision: 1,
    deadlineGeneration: 1,
    meta: { killturn: 24, scenarioMeta },
};
const lifecycleGeneral: TurnGeneral = {
    id: lifecycleGeneralId,
    userId: lifecycleUserId,
    name: '초기화lifecycle장수',
    nationId: 0,
    cityId: 0,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    turnTime: new Date('2026-07-31T10:30:00.000Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24, accountIconUpdatedAt: '2026-07-31T10:10:00.000Z', preserved: 'yes' },
    penalty: {},
    officerLevel: 0,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 20,
    npcState: 0,
    picture: 'before-lifecycle-reset.png',
    imageServer: 1,
};

const assertDedicatedDatabase = (rawUrl: string): void => {
    const schema = new URL(rawUrl).searchParams.get('schema');
    if (!schema?.endsWith('immediate_action_integration')) {
        throw new Error(`Refusing to mutate non-dedicated schema: ${schema ?? '(missing)'}`);
    }
};

integration('account icon reset reconciliation PostgreSQL queue', () => {
    let db: GamePrismaClient;
    let disconnect: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        assertDedicatedDatabase(databaseUrl!);
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnect = () => connector.disconnect();
        await db.inputEvent.deleteMany({ where: { requestId: { startsWith: requestId } } });
        await db.inputEvent.deleteMany({ where: { requestId: { startsWith: lifecycleRequestId } } });
        await db.general.deleteMany({ where: { id: { in: [generalId, lifecycleGeneralId] } } });
        await db.worldState.deleteMany({ where: { id: lifecycleWorldId } });
        await db.worldState.create({
            data: {
                id: lifecycleWorldId,
                scenarioCode: 'account-icon-reset-lifecycle',
                currentYear: lifecycleState.currentYear,
                currentMonth: lifecycleState.currentMonth,
                tickSeconds: lifecycleState.tickSeconds,
                clockBaseTime: lifecycleState.clockBaseTime,
                clockTick: BigInt(lifecycleState.clockTick ?? 0),
                clockMode: lifecycleState.clockMode ?? 'manual',
                clockWallAnchor: lifecycleState.clockWallAnchor,
                lastTurnTick: BigInt(lifecycleState.lastTurnTick ?? 0),
                clockPhase: lifecycleState.clockPhase ?? 'MANUAL',
                clockRevision: BigInt(lifecycleState.clockRevision ?? 1),
                deadlineGeneration: BigInt(lifecycleState.deadlineGeneration ?? 1),
                config: JSON.parse(JSON.stringify(scenarioConfig)) as GamePrisma.InputJsonValue,
                meta: lifecycleState.meta as GamePrisma.InputJsonValue,
            },
        });
        await db.general.create({
            data: {
                id: generalId,
                userId,
                name: '초기화복구장수',
                turnTime: new Date('2026-07-31T10:10:00.000Z'),
                picture: 'before-reset.png',
                imageServer: 1,
                meta: { killturn: 24, accountIconUpdatedAt: '2026-07-31T09:00:00.000Z' },
            },
        });
        await db.general.create({
            data: {
                id: lifecycleGeneral.id,
                userId: lifecycleGeneral.userId,
                name: lifecycleGeneral.name,
                turnTime: lifecycleGeneral.turnTime,
                picture: lifecycleGeneral.picture,
                imageServer: lifecycleGeneral.imageServer,
                meta: lifecycleGeneral.meta,
            },
        });
    });

    afterAll(async () => {
        if (db) {
            await db.inputEvent.deleteMany({ where: { requestId: { startsWith: requestId } } });
            await db.inputEvent.deleteMany({ where: { requestId: { startsWith: lifecycleRequestId } } });
            await db.general.deleteMany({ where: { id: { in: [generalId, lifecycleGeneralId] } } });
            await db.worldState.deleteMany({ where: { id: lifecycleWorldId } });
        }
        await disconnect?.();
    });

    it('deduplicates an active durable enqueue and creates one bounded retry after terminal failure', async () => {
        const source = {
            listResets: vi.fn(async () => [
                {
                    userId,
                    resetRevision: revision,
                    current: {
                        revision,
                        picture: 'default.jpg',
                        imageServer: 0,
                    },
                },
            ]),
        };
        const reconciler = new AccountIconResetReconciler(
            db,
            source,
            new DatabaseTurnDaemonTransport(db, 1_000),
            30_000
        );

        await reconciler.reconcileOnce();
        await reconciler.reconcileOnce();

        await expect(db.inputEvent.findMany({ where: { requestId } })).resolves.toEqual([
            expect.objectContaining({
                requestId,
                target: 'ENGINE',
                eventType: 'adjustGeneralIcon',
                status: 'PENDING',
                actorUserId: userId,
                payload: {
                    type: 'adjustGeneralIcon',
                    requestId,
                    userId,
                    picture: 'default.jpg',
                    imageServer: 0,
                    iconRevision: revision,
                },
            }),
        ]);

        await db.inputEvent.update({
            where: { requestId },
            data: {
                status: 'FAILED',
                attempts: 3,
                error: 'simulated terminal failure',
                completedAt: new Date(),
            },
        });
        await reconciler.reconcileOnce();
        await reconciler.reconcileOnce();

        await expect(
            db.inputEvent.findMany({
                where: { requestId: { startsWith: requestId } },
                orderBy: { sequence: 'asc' },
            })
        ).resolves.toEqual([
            expect.objectContaining({ requestId, status: 'FAILED' }),
            expect.objectContaining({
                requestId: retryRequestId,
                status: 'PENDING',
                actorUserId: userId,
                payload: {
                    type: 'adjustGeneralIcon',
                    requestId: retryRequestId,
                    userId,
                    picture: 'default.jpg',
                    imageServer: 0,
                    iconRevision: revision,
                },
            }),
        ]);
    });

    it('flows from reconciliation through the durable daemon lifecycle and persists one reset', async () => {
        const source = {
            listResets: vi.fn(async () => [
                {
                    userId: lifecycleUserId,
                    resetRevision: lifecycleRevision,
                    current: {
                        revision: lifecycleRevision,
                        picture: 'default.jpg',
                        imageServer: 0,
                    },
                },
            ]),
        };
        const reconciler = new AccountIconResetReconciler(
            db,
            source,
            new DatabaseTurnDaemonTransport(db, 1_000),
            30_000
        );
        await reconciler.reconcileOnce();

        const snapshot: TurnWorldSnapshot = {
            generals: [lifecycleGeneral],
            cities: [],
            nations: [],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            scenarioConfig,
            scenarioMeta,
            map,
        };
        const world = new InMemoryTurnWorld(lifecycleState, snapshot, { schedule });
        const queue = new DatabaseTurnDaemonCommandQueue(db);
        await queue.initialize();
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        const stateManager = new EngineStateManager();
        stateManager.register('world', {
            capture: () => world.captureState(),
            restore: (captured) => world.restoreState(captured),
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
                        throw new Error('scheduled turn must not run in account icon lifecycle integration');
                    },
                },
                commandHandler: createTurnDaemonCommandHandler({ world }),
                hooks: hooks.hooks,
                stateManager,
            },
            {
                profile: 'account-icon-reset-lifecycle',
                defaultBudget: { budgetMs: 100, maxGenerals: 1, catchUpCap: 1 },
            }
        );
        const waitForSuccess = async () => {
            for (let attempt = 0; attempt < 200; attempt += 1) {
                const event = await db.inputEvent.findUnique({ where: { requestId: lifecycleRequestId } });
                if (event?.status === 'SUCCEEDED' && event.lockedBy === null) return event;
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            const observed = await db.inputEvent.findUnique({ where: { requestId: lifecycleRequestId } });
            throw new Error(
                `Timed out waiting for ${lifecycleRequestId} to succeed: ${JSON.stringify(
                    observed && {
                        status: observed.status,
                        attempts: observed.attempts,
                        error: observed.error,
                        result: observed.result,
                        lockedBy: observed.lockedBy,
                    }
                )}`
            );
        };

        let loop: Promise<void> | undefined;
        try {
            loop = lifecycle.start();
            await expect(waitForSuccess()).resolves.toMatchObject({
                attempts: 1,
                result: {
                    type: 'adjustGeneralIcon',
                    ok: true,
                    generalId: lifecycleGeneralId,
                    updated: true,
                },
            });
        } finally {
            await lifecycle.stop('account icon reset integration finished');
            await loop;
            await hooks.close();
        }

        await expect(db.general.findUniqueOrThrow({ where: { id: lifecycleGeneralId } })).resolves.toMatchObject({
            picture: 'default.jpg',
            imageServer: 0,
            meta: { accountIconUpdatedAt: lifecycleRevision, preserved: 'yes' },
        });
        const reloaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        expect(reloaded.snapshot.generals.find((entry) => entry.id === lifecycleGeneralId)).toMatchObject({
            picture: 'default.jpg',
            imageServer: 0,
            meta: { accountIconUpdatedAt: lifecycleRevision, preserved: 'yes' },
        });

        await reconciler.reconcileOnce();
        await expect(db.inputEvent.count({ where: { requestId: { startsWith: lifecycleRequestId } } })).resolves.toBe(
            1
        );
    }, 15_000);
});
