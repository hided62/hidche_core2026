import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SystemClock } from '@sammo-ts/common';
import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';
import type { MapDefinition, ScenarioConfig, ScenarioMeta, TurnSchedule } from '@sammo-ts/logic';

import { DatabaseTurnDaemonCommandQueue } from '../src/lifecycle/databaseCommandQueue.js';
import { TurnDaemonLifecycle } from '../src/lifecycle/turnDaemonLifecycle.js';
import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { EngineStateManager } from '../src/turn/engineStateManager.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';
import { loadTurnWorldFromDatabase } from '../src/turn/worldLoader.js';

const databaseUrl = process.env.IMMEDIATE_ACTION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const worldId = 991_731;
const generalId = 991_731;
const cityId = 991_731;
const existingNationId = 991_730;
const requestId = 'integration:engine:immediate-action-uprising';
const occupiedUniqueItem = 'che_무기_12_칠성검';

const assertDedicatedDatabase = (rawUrl: string): void => {
    const schema = new URL(rawUrl).searchParams.get('schema');
    if (!schema?.endsWith('immediate_action_integration')) {
        throw new Error(`Refusing to mutate non-dedicated schema: ${schema ?? '(missing)'}`);
    }
};

const map: MapDefinition = {
    id: 'immediate-action-integration',
    name: '즉시 행동 통합',
    cities: [
        {
            id: cityId,
            name: '낙양',
            level: 5,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [],
            max: {
                population: 100_000,
                agriculture: 2_000,
                commerce: 2_000,
                security: 2_000,
                defence: 2_000,
                wall: 2_000,
            },
            initial: {
                population: 10_000,
                agriculture: 1_000,
                commerce: 1_000,
                security: 1_000,
                defence: 1_000,
                wall: 1_000,
            },
        },
    ],
};

const scenarioMeta: ScenarioMeta = {
    title: '즉시 행동 통합',
    startYear: 180,
    life: null,
    fiction: null,
    history: [],
    ignoreDefaultEvents: false,
};

const scenarioConfig: ScenarioConfig = {
    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 65 },
    iconPath: '',
    map: {},
    const: {
        openingPartYear: 3,
        baseRice: 2_000,
        allItems: {
            weapon: {
                [occupiedUniqueItem]: 1,
            },
        },
        maxUniqueItemLimit: [[-1, 1]],
        minMonthToAllowInheritItem: 0,
    },
    environment: {
        mapName: 'che',
        unitSet: 'che',
    },
};

const state: TurnWorldState = {
    id: worldId,
    currentYear: 180,
    currentMonth: 1,
    tickSeconds: 600,
    lastTurnTime: new Date('2026-07-31T00:00:00.000Z'),
    meta: {
        hiddenSeed: 'immediate-action-integration',
        killturn: 24,
        opentime: '2026-08-01T00:00:00.000Z',
        scenarioId: 1000,
    },
};

const general: TurnGeneral = {
    id: generalId,
    userId: 'immediate-action-user',
    name: '통합장수',
    nationId: 0,
    cityId,
    troopId: 0,
    stats: { leadership: 70, strength: 60, intelligence: 50 },
    turnTime: new Date('2026-07-31T00:10:00.000Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: {
        killturn: 3,
        inherit_active_action: 0,
        inheritRandomUnique: true,
        leadership_exp: 0,
        strength_exp: 0,
        intel_exp: 0,
    },
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
};

integration('immediate general action persistence', () => {
    let db: GamePrismaClient;
    let disconnect: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        assertDedicatedDatabase(databaseUrl!);
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnect = () => connector.disconnect();

        await db.inputEvent.deleteMany({ where: { requestId } });
        await db.auction.deleteMany({ where: { targetCode: occupiedUniqueItem } });
        await db.logEntry.deleteMany({
            where: {
                OR: [{ generalId }, { nationId: { gte: existingNationId } }, { text: { contains: general.name } }],
            },
        });
        await db.nationTurn.deleteMany({ where: { nationId: { gte: existingNationId } } });
        await db.diplomacy.deleteMany({
            where: {
                OR: [{ srcNationId: { gte: existingNationId } }, { destNationId: { gte: existingNationId } }],
            },
        });
        await db.general.deleteMany({ where: { id: generalId } });
        await db.city.deleteMany({ where: { id: cityId } });
        await db.nation.deleteMany({ where: { id: { gte: existingNationId } } });
        await db.worldState.deleteMany({ where: { id: worldId } });

        await db.worldState.create({
            data: {
                id: worldId,
                scenarioCode: 'immediate-action-integration',
                currentYear: state.currentYear,
                currentMonth: state.currentMonth,
                tickSeconds: state.tickSeconds,
                config: JSON.parse(JSON.stringify(scenarioConfig)) as GamePrisma.InputJsonValue,
                meta: state.meta as GamePrisma.InputJsonValue,
            },
        });
        await db.nation.create({
            data: {
                id: existingNationId,
                name: general.name,
                color: '#111111',
                capitalCityId: 0,
                chiefGeneralId: 0,
                gold: 0,
                rice: 0,
                tech: 0,
                level: 1,
                typeCode: 'che_중립',
                meta: {},
            },
        });
        await db.city.create({
            data: {
                id: cityId,
                name: '낙양',
                level: 5,
                nationId: 0,
                supplyState: 1,
                frontState: 0,
                population: 10_000,
                populationMax: 100_000,
                agriculture: 1_000,
                agricultureMax: 2_000,
                commerce: 1_000,
                commerceMax: 2_000,
                security: 1_000,
                securityMax: 2_000,
                defence: 1_000,
                defenceMax: 2_000,
                wall: 1_000,
                wallMax: 2_000,
                region: 1,
            },
        });
        await db.general.create({
            data: {
                id: general.id,
                userId: general.userId,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                troopId: general.troopId,
                npcState: general.npcState,
                leadership: general.stats.leadership,
                strength: general.stats.strength,
                intel: general.stats.intelligence,
                officerLevel: general.officerLevel,
                experience: general.experience,
                dedication: general.dedication,
                gold: general.gold,
                rice: general.rice,
                crew: general.crew,
                crewTypeId: general.crewTypeId,
                train: general.train,
                atmos: general.atmos,
                turnTime: general.turnTime,
                age: general.age,
                meta: general.meta as GamePrisma.InputJsonValue,
                penalty: general.penalty as GamePrisma.InputJsonValue,
            },
        });
    });

    afterAll(async () => {
        if (!db) {
            await disconnect?.();
            return;
        }
        await db.inputEvent.deleteMany({ where: { requestId } });
        await db.auction.deleteMany({ where: { targetCode: occupiedUniqueItem } });
        await db.logEntry.deleteMany({
            where: {
                OR: [{ generalId }, { nationId: { gte: existingNationId } }, { text: { contains: general.name } }],
            },
        });
        await db.nationTurn.deleteMany({ where: { nationId: { gte: existingNationId } } });
        await db.diplomacy.deleteMany({
            where: {
                OR: [{ srcNationId: { gte: existingNationId } }, { destNationId: { gte: existingNationId } }],
            },
        });
        await db.general.deleteMany({ where: { id: generalId } });
        await db.city.deleteMany({ where: { id: cityId } });
        await db.nation.deleteMany({ where: { id: { gte: existingNationId } } });
        await db.worldState.deleteMany({ where: { id: worldId } });
        await disconnect?.();
    });

    it('flushes and reloads the nation, diplomacy, officer turns, logs, and general state together', async () => {
        const snapshot: TurnWorldSnapshot = {
            generals: [general],
            cities: [
                {
                    id: cityId,
                    name: '낙양',
                    level: 5,
                    nationId: 0,
                    state: 0,
                    supplyState: 1,
                    frontState: 0,
                    population: 10_000,
                    populationMax: 100_000,
                    agriculture: 1_000,
                    agricultureMax: 2_000,
                    commerce: 1_000,
                    commerceMax: 2_000,
                    security: 1_000,
                    securityMax: 2_000,
                    defence: 1_000,
                    defenceMax: 2_000,
                    wall: 1_000,
                    wallMax: 2_000,
                    meta: {},
                },
            ],
            nations: [
                {
                    id: existingNationId,
                    name: general.name,
                    color: '#111111',
                    capitalCityId: 0,
                    chiefGeneralId: 0,
                    gold: 0,
                    rice: 0,
                    level: 1,
                    typeCode: 'che_중립',
                    power: 0,
                    meta: {},
                },
            ],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            scenarioConfig,
            scenarioMeta,
            map,
        };
        const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
        const world = new InMemoryTurnWorld(state, snapshot, { schedule });
        const reservedTurns = await createReservedTurnStore({ databaseUrl: databaseUrl! });
        const handler = createTurnDaemonCommandHandler({
            world,
            reservedTurns: reservedTurns.store,
            scenarioMeta,
            map,
        });
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world, {
            reservedTurns: reservedTurns.store,
        });
        await db.auction.createMany({
            data: (['OPEN', 'FINALIZING'] as const).map((status) => ({
                type: 'UNIQUE_ITEM' as const,
                targetCode: occupiedUniqueItem,
                hostGeneralId: generalId,
                hostName: general.name,
                detail: {},
                status,
                closeAt: new Date('2026-08-01T00:00:00.000Z'),
            })),
        });
        await db.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'buildNationCandidate',
                actorUserId: general.userId,
                payload: {
                    type: 'buildNationCandidate',
                    requestId,
                    userId: general.userId,
                    generalId,
                } as GamePrisma.InputJsonValue,
            },
        });

        const stateManager = new EngineStateManager();
        stateManager.register('world', {
            capture: () => world.captureState(),
            restore: (captured) => world.restoreState(captured),
        });
        stateManager.register('reservedTurns', {
            capture: () => reservedTurns.store.captureState(),
            restore: (captured) => reservedTurns.store.restoreState(captured),
        });
        const stateStore = {
            loadLastTurnTime: async () => new Date(state.lastTurnTime),
            loadNextGeneralTurnTime: async () => null,
            saveLastTurnTime: async () => {},
            loadCheckpoint: async () => undefined,
            saveCheckpoint: async () => {},
        };
        const processor = {
            run: async () => {
                throw new Error('scheduled turn must not run in the immediate-action integration test');
            },
        };
        const buildLifecycle = (
            queue: DatabaseTurnDaemonCommandQueue,
            lifecycleHooks: ConstructorParameters<typeof TurnDaemonLifecycle>[0]['hooks']
        ) =>
            new TurnDaemonLifecycle(
                {
                    clock: new SystemClock(),
                    controlQueue: queue,
                    commandResponder: queue,
                    getNextTickTime: () => new Date(Date.now() + 3_600_000),
                    stateStore,
                    processor,
                    commandHandler: handler,
                    hooks: lifecycleHooks,
                    stateManager,
                },
                {
                    profile: 'immediate-action-integration',
                    defaultBudget: { budgetMs: 100, maxGenerals: 1, catchUpCap: 1 },
                }
            );
        const waitForEvent = async (status: 'PENDING' | 'SUCCEEDED') => {
            for (let attempt = 0; attempt < 200; attempt += 1) {
                const event = await db.inputEvent.findUnique({ where: { requestId } });
                if (event?.status === status && (status !== 'SUCCEEDED' || event.lockedBy === null)) {
                    return event;
                }
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            throw new Error(`Timed out waiting for ${requestId} to become ${status}.`);
        };

        try {
            const firstQueue = new DatabaseTurnDaemonCommandQueue(db);
            await firstQueue.initialize();
            let observeInjectedFailure: (() => void) | undefined;
            const injectedFailureObserved = new Promise<void>((resolve) => {
                observeInjectedFailure = resolve;
            });
            const firstLifecycle = buildLifecycle(firstQueue, {
                ...hooks.hooks,
                executeCommand: async (_failedRequestId, execute) =>
                    db.$transaction(async (transaction) => {
                        await execute({ db: transaction });
                        throw new Error('injected immediate-action commit failure');
                    }),
                onRunError: async () => {
                    observeInjectedFailure?.();
                },
            });
            const firstLoop = firstLifecycle.start();
            await injectedFailureObserved;
            await firstLifecycle.stop('injected failure observed');
            await firstLoop;

            await expect(waitForEvent('PENDING')).resolves.toMatchObject({
                attempts: 1,
                error: 'injected immediate-action commit failure',
            });
            expect(world.getGeneralById(generalId)).toMatchObject({
                nationId: 0,
                officerLevel: 0,
                role: { items: { weapon: null } },
            });
            expect(world.listNations().map((nation) => nation.id)).toEqual([existingNationId]);
            expect(reservedTurns.store.peekDirtyState()).toEqual({
                generalIds: [],
                generalInitializationIds: [],
                generalLeaseIds: [],
                nationKeys: [],
                nationInitializationKeys: [],
                nationLeaseKeys: [],
            });
            await expect(db.nation.findUnique({ where: { id: existingNationId + 1 } })).resolves.toBeNull();
            await expect(db.general.findUniqueOrThrow({ where: { id: generalId } })).resolves.toMatchObject({
                nationId: 0,
                officerLevel: 0,
            });

            const retryQueue = new DatabaseTurnDaemonCommandQueue(db);
            await retryQueue.initialize();
            const retryLifecycle = buildLifecycle(retryQueue, hooks.hooks);
            const retryLoop = retryLifecycle.start();
            await expect(waitForEvent('SUCCEEDED')).resolves.toMatchObject({
                attempts: 2,
                actorUserId: general.userId,
                result: expect.objectContaining({
                    type: 'buildNationCandidate',
                    ok: true,
                    generalId,
                }),
            });
            await retryLifecycle.stop('retry committed');
            await retryLoop;
        } finally {
            await hooks.close();
            await reservedTurns.close();
        }

        const persistedGeneral = await db.general.findUniqueOrThrow({ where: { id: generalId } });
        expect(persistedGeneral).toMatchObject({
            nationId: existingNationId + 1,
            officerLevel: 12,
            experience: 100,
            dedication: 100,
            turnTime: general.turnTime,
            lastTurn: { command: '거병', arg: {} },
            weaponCode: 'None',
            meta: expect.objectContaining({
                inherit_active_action: 1,
                killturn: 24,
                belong: 1,
                officer_city: 0,
            }),
        });
        await expect(db.nation.findUniqueOrThrow({ where: { id: existingNationId + 1 } })).resolves.toMatchObject({
            name: `㉥${general.name}`,
            chiefGeneralId: generalId,
            rice: 2_000,
            meta: expect.objectContaining({ gennum: 1, secretlimit: 1 }),
        });
        await expect(
            db.diplomacy.findMany({
                where: {
                    OR: [{ srcNationId: existingNationId + 1 }, { destNationId: existingNationId + 1 }],
                },
            })
        ).resolves.toHaveLength(2);
        for (const officerLevel of [11, 12]) {
            await expect(
                db.nationTurn.findMany({
                    where: {
                        nationId: existingNationId + 1,
                        officerLevel,
                    },
                    orderBy: { turnIdx: 'asc' },
                })
            ).resolves.toEqual(
                Array.from({ length: 12 }, (_, turnIdx) =>
                    expect.objectContaining({
                        officerLevel,
                        turnIdx,
                        actionCode: '휴식',
                        arg: {},
                    })
                )
            );
        }
        await expect(
            db.logEntry.findMany({
                where: {
                    OR: [
                        { scope: 'GENERAL', category: 'ACTION', generalId },
                        { scope: 'GENERAL', category: 'HISTORY', generalId },
                        { scope: 'NATION', category: 'HISTORY', nationId: existingNationId + 1 },
                        { scope: 'SYSTEM', category: 'SUMMARY' },
                        { scope: 'SYSTEM', category: 'HISTORY' },
                    ],
                },
            })
        ).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    scope: 'GENERAL',
                    category: 'ACTION',
                    generalId,
                    text: expect.stringContaining('거병에 성공하였습니다. <1>00:10</>'),
                }),
                expect.objectContaining({
                    scope: 'GENERAL',
                    category: 'HISTORY',
                    generalId,
                    text: expect.stringContaining('낙양'),
                }),
                expect.objectContaining({
                    scope: 'NATION',
                    category: 'HISTORY',
                    nationId: existingNationId + 1,
                    text: expect.stringContaining('통합장수'),
                }),
                expect.objectContaining({
                    scope: 'SYSTEM',
                    category: 'SUMMARY',
                    text: expect.stringContaining('거병하였습니다'),
                }),
                expect.objectContaining({
                    scope: 'SYSTEM',
                    category: 'HISTORY',
                    text: expect.stringContaining('【거병】'),
                }),
            ])
        );

        const reloaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        expect(reloaded.snapshot.generals.find((entry) => entry.id === generalId)).toMatchObject({
            nationId: existingNationId + 1,
            officerLevel: 12,
            experience: 100,
            dedication: 100,
            turnTime: general.turnTime,
        });
        expect(reloaded.snapshot.nations.find((entry) => entry.id === existingNationId + 1)).toMatchObject({
            name: `㉥${general.name}`,
            chiefGeneralId: generalId,
            rice: 2_000,
        });
    });
});
