import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';
import { GAME_TICKS_PER_TURN } from '@sammo-ts/common';
import { SystemClock } from '@sammo-ts/common';
import { DatabaseTurnDaemonCommandQueue } from '../src/lifecycle/databaseCommandQueue.js';
import { getNextTickTime } from '../src/lifecycle/getNextTickTime.js';
import { TurnDaemonLifecycle } from '../src/lifecycle/turnDaemonLifecycle.js';
import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { EngineStateManager } from '../src/turn/engineStateManager.js';
import { InMemoryTurnStateStore } from '../src/turn/inMemoryStateStore.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const requestId = 'integration:engine:runtime-clock-shift';
const actionId = 'b9f68480-dba9-4e03-a62b-499e6234f18a';
const runtimeSettingsRequestId = 'integration:engine:runtime-game-settings';
const runtimeSettingsActionId = 'c9f68480-dba9-4e03-a62b-499e6234f18a';
const generalIds = [990_301, 990_302, 990_303, 990_304] as const;
const runtimeSettingsLogText = 'runtime-settings-existing-log';
const backlogPoolUniqueName = 'rebase-pool-990304';

const buildGeneral = (id: number, turnTime: Date): TurnGeneral =>
    ({
        id,
        name: `시간조정${id}`,
        nationId: 0,
        cityId: 1,
        troopId: 0,
        stats: { leadership: 50, strength: 50, intelligence: 50 },
        turnTime,
        role: {
            items: { horse: null, weapon: null, book: null, item: null },
            personality: null,
            specialDomestic: null,
            specialWar: null,
        },
        triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
        meta: { killturn: 24 },
        officerLevel: 0,
        experience: 0,
        dedication: 0,
        injury: 0,
        gold: 1000,
        rice: 1000,
        crew: 0,
        crewTypeId: 0,
        train: 0,
        atmos: 0,
        age: 30,
        npcState: 0,
    }) as TurnGeneral;

const waitForSucceeded = async (db: GamePrismaClient, targetRequestId = requestId): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const event = await db.inputEvent.findUnique({
            where: { requestId: targetRequestId },
            select: { status: true },
        });
        if (event?.status === 'SUCCEEDED') {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const event = await db.inputEvent.findUnique({
        where: { requestId: targetRequestId },
        select: { status: true, error: true, attempts: true },
    });
    throw new Error(`runtime input event did not complete: ${JSON.stringify(event)}`);
};

integration('runtime clock shift persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const cleanupFixtures = async (): Promise<void> => {
        await db.inputEvent.deleteMany({ where: { requestId: { in: [requestId, runtimeSettingsRequestId] } } });
        await db.votePoll.deleteMany({ where: { openerGeneralId: generalIds[2] } });
        await db.message.deleteMany({ where: { mailbox: generalIds[2] } });
        await db.logEntry.deleteMany({ where: { text: runtimeSettingsLogText } });
        await db.auction.deleteMany({ where: { hostGeneralId: { in: [...generalIds] } } });
        await db.selectPoolEntry.deleteMany({ where: { uniqueName: backlogPoolUniqueName } });
        await db.general.deleteMany({ where: { id: { in: [...generalIds] } } });
        await db.worldState.deleteMany({
            where: {
                scenarioCode: { in: ['runtime-clock-shift', 'runtime-game-settings', 'realtime-backlog-rebase'] },
            },
        });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
    });

    beforeEach(cleanupFixtures);

    afterAll(async () => {
        await cleanupFixtures();
        await closeDb?.();
    });

    it('atomically shifts world, generals, and only OPEN auctions through the durable command path', async () => {
        const base = new Date('2099-07-30T10:00:00.000Z');
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'runtime-clock-shift',
                currentYear: 190,
                currentMonth: 1,
                tickSeconds: 600,
                clockBaseTime: base,
                clockTick: 0,
                clockMode: 'realtime',
                clockWallAnchor: base,
                lastTurnTick: 0,
                config: {},
                meta: {
                    lastTurnTime: base.toISOString(),
                    turntime: '2099-07-30 10:00:00',
                    starttime: '2099-07-01 00:00:00',
                },
            },
        });
        const generals = [
            buildGeneral(generalIds[0], new Date('2099-07-30T10:10:00.000Z')),
            buildGeneral(generalIds[1], new Date('2099-07-30T10:20:00.000Z')),
        ];
        await db.general.createMany({
            data: generals.map((general) => ({
                id: general.id,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                troopId: general.troopId,
                turnTime: general.turnTime,
                turnTick: BigInt((general.id === generalIds[0] ? 1 : 2) * GAME_TICKS_PER_TURN),
            })),
        });
        const auctionRows = await Promise.all(
            (['OPEN', 'FINALIZING', 'FINISHED', 'CANCELED'] as const).map((status, index) =>
                db.auction.create({
                    data: {
                        type: 'BUY_RICE',
                        hostGeneralId: generals[index % generals.length]!.id,
                        detail: {},
                        status,
                        closeAt: new Date(`2099-07-30T1${index}:00:00.000Z`),
                    },
                })
            )
        );

        const state: TurnWorldState = {
            id: row.id,
            currentYear: 190,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: base,
            clockBaseTime: base,
            clockTick: 0,
            clockMode: 'realtime',
            clockWallAnchor: base,
            lastTurnTick: 0,
            meta: row.meta as Record<string, unknown>,
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: {
                id: 'test',
                name: 'test',
                cities: [],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            },
            generals,
            cities: [],
            nations: [],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        const stateStore = new InMemoryTurnStateStore(world);
        await stateStore.saveCheckpoint({
            turnTime: '2099-07-30T10:00:00.000Z',
            generalId: 0,
            year: 190,
            month: 1,
        });
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        const queue = new DatabaseTurnDaemonCommandQueue(db);
        await queue.initialize();
        const stateManager = new EngineStateManager();
        stateManager.register('world', {
            capture: () => world.captureState(),
            restore: (saved) => world.restoreState(saved),
        });
        const lifecycle = new TurnDaemonLifecycle(
            {
                clock: new SystemClock(),
                controlQueue: queue,
                commandResponder: queue,
                commandHandler: createTurnDaemonCommandHandler({ world }),
                hooks: hooks.hooks,
                stateManager,
                stateStore,
                getNextTickTime: (lastTurnTime) => getNextTickTime(lastTurnTime, 60),
                processor: {
                    run: async () => ({
                        lastTurnTime: world.getState().lastTurnTime.toISOString(),
                        processedGenerals: 0,
                        processedTurns: 0,
                        durationMs: 0,
                        partial: false,
                    }),
                },
            },
            {
                profile: 'integration',
                defaultBudget: { budgetMs: 1000, maxGenerals: 10, catchUpCap: 1 },
            }
        );

        await db.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'shiftSchedule',
                payload: {
                    type: 'shiftSchedule',
                    requestId,
                    actionId,
                    deltaMinutes: -15,
                } as GamePrisma.InputJsonValue,
            },
        });
        const loop = lifecycle.start();
        try {
            await waitForSucceeded(db);
        } finally {
            await lifecycle.stop('test complete');
            await loop;
            await hooks.close();
        }

        expect(world.getState().lastTurnTime.toISOString()).toBe('2099-07-30T09:45:00.000Z');
        expect(world.getGeneralById(generalIds[0])?.turnTime.toISOString()).toBe('2099-07-30T09:55:00.000Z');
        expect(await stateStore.loadCheckpoint()).toMatchObject({
            turnTime: '2099-07-30T09:45:00.000Z',
            generalId: 0,
        });
        expect(lifecycle.getStatus().nextTurnTime).toBe('2099-07-30T09:55:00.000Z');
        const storedWorld = await db.worldState.findUniqueOrThrow({ where: { id: row.id } });
        expect(storedWorld.meta).toMatchObject({
            lastTurnTime: '2099-07-30T09:45:00.000Z',
            starttime: '2099-06-30 23:45:00',
        });
        expect(storedWorld.clockTick).toBe(0n);
        expect(storedWorld.lastTurnTick).toBe(0n);
        const storedGeneral = await db.general.findUniqueOrThrow({ where: { id: generalIds[1] } });
        expect(storedGeneral.turnTime.toISOString()).toBe('2099-07-30T10:05:00.000Z');
        expect(storedGeneral.turnTick).toBe(BigInt(2 * GAME_TICKS_PER_TURN));
        const storedAuctions = await db.auction.findMany({
            where: { id: { in: auctionRows.map((auction) => auction.id) } },
        });
        const closeAtById = new Map(storedAuctions.map((auction) => [auction.id, auction.closeAt.toISOString()]));
        expect(auctionRows.map((auction) => closeAtById.get(auction.id))).toEqual([
            '2099-07-30T09:45:00.000Z',
            '2099-07-30T11:00:00.000Z',
            '2099-07-30T12:00:00.000Z',
            '2099-07-30T13:00:00.000Z',
        ]);
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).toMatchObject({
            status: 'SUCCEEDED',
            attempts: 1,
            result: {
                type: 'shiftSchedule',
                ok: true,
                actionId,
                deltaMinutes: -15,
                shiftedGenerals: 2,
                shiftedAuctions: 1,
            },
        });

        await db.worldState.delete({ where: { id: row.id } });
    });

    it('atomically rebases a long realtime backlog and open auction deadlines', async () => {
        const base = new Date('2099-09-01T00:00:00.000Z');
        const resumedAt = new Date('2099-09-01T00:35:00.000Z');
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'realtime-backlog-rebase',
                currentYear: 192,
                currentMonth: 3,
                tickSeconds: 300,
                clockBaseTime: base,
                clockTick: 0,
                clockMode: 'realtime',
                clockWallAnchor: base,
                lastTurnTick: 0,
                config: {},
                meta: {
                    lastTurnTime: base.toISOString(),
                    turntime: '2099-09-01 00:00:00.123456',
                    starttime: '2099-08-01 00:00:00',
                },
            },
        });
        const general = buildGeneral(generalIds[3], new Date('2099-09-01T00:05:00.000Z'));
        await db.general.create({
            data: {
                id: general.id,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                troopId: general.troopId,
                turnTime: general.turnTime,
                turnTick: BigInt(GAME_TICKS_PER_TURN),
            },
        });
        const [openAuction, finishedAuction] = await Promise.all(
            (['OPEN', 'FINISHED'] as const).map((status) =>
                db.auction.create({
                    data: {
                        type: 'BUY_RICE',
                        hostGeneralId: general.id,
                        detail: {},
                        status,
                        closeAt: new Date('2099-09-01T00:10:00.000Z'),
                        closeTick: BigInt(2 * GAME_TICKS_PER_TURN),
                    },
                })
            )
        );
        const poolEntry = await db.selectPoolEntry.create({
            data: {
                uniqueName: backlogPoolUniqueName,
                ownerUserId: 'rebase-pool-user',
                generalId: null,
                reservedUntil: new Date('2099-09-01T00:10:00.000Z'),
                reservedUntilTick: BigInt(2 * GAME_TICKS_PER_TURN),
                info: {
                    uniqueName: backlogPoolUniqueName,
                    generalName: '재개예약후보',
                    leadership: 70,
                    strength: 70,
                    intel: 10,
                    specialDomestic: null,
                    dex: [10, 10, 10, 10, 10],
                    imgsvr: 0,
                    picture: 'default.jpg',
                } as GamePrisma.InputJsonValue,
            },
        });
        const world = new InMemoryTurnWorld(
            {
                id: row.id,
                currentYear: 192,
                currentMonth: 3,
                tickSeconds: 300,
                lastTurnTime: base,
                clockBaseTime: base,
                clockTick: 0,
                clockMode: 'realtime',
                clockWallAnchor: base,
                lastTurnTick: 0,
                meta: row.meta as Record<string, unknown>,
            },
            {
                scenarioConfig: {
                    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                    iconPath: '',
                    map: {},
                    const: {},
                    environment: { mapName: 'test', unitSet: 'default' },
                },
                map: {
                    id: 'test',
                    name: 'test',
                    cities: [],
                    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
                },
                generals: [general],
                cities: [],
                nations: [],
                troops: [],
                diplomacy: [],
                events: [],
                initialEvents: [],
            },
            { schedule: { entries: [{ startMinute: 0, tickMinutes: 5 }] } }
        );
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            expect(world.rebaseRealtimeBacklog(resumedAt)).toMatchObject({ skippedTurns: 7 });
            await hooks.hooks.flushChanges?.({
                lastTurnTime: resumedAt.toISOString(),
                processedGenerals: 0,
                processedTurns: 0,
                durationMs: 0,
                partial: false,
            });
        } finally {
            await hooks.close();
        }

        const storedWorld = await db.worldState.findUniqueOrThrow({ where: { id: row.id } });
        expect(storedWorld).toMatchObject({
            clockTick: BigInt(7 * GAME_TICKS_PER_TURN),
            lastTurnTick: BigInt(7 * GAME_TICKS_PER_TURN),
            clockWallAnchor: resumedAt,
        });
        const storedGeneral = await db.general.findUniqueOrThrow({ where: { id: general.id } });
        expect(storedGeneral).toMatchObject({
            turnTick: BigInt(8 * GAME_TICKS_PER_TURN),
            turnTime: new Date('2099-09-01T00:40:00.000Z'),
        });
        expect(await db.auction.findUniqueOrThrow({ where: { id: openAuction.id } })).toMatchObject({
            closeTick: BigInt(9 * GAME_TICKS_PER_TURN),
            closeAt: new Date('2099-09-01T00:45:00.000Z'),
        });
        expect(await db.auction.findUniqueOrThrow({ where: { id: finishedAuction.id } })).toMatchObject({
            closeTick: BigInt(2 * GAME_TICKS_PER_TURN),
            closeAt: new Date('2099-09-01T00:10:00.000Z'),
        });
        expect(await db.selectPoolEntry.findUniqueOrThrow({ where: { id: poolEntry.id } })).toMatchObject({
            ownerUserId: 'rebase-pool-user',
            generalId: null,
            reservedUntilTick: BigInt(9 * GAME_TICKS_PER_TURN),
            reservedUntil: new Date('2099-09-01T00:45:00.000Z'),
        });

        await db.auction.deleteMany({ where: { id: { in: [openAuction.id, finishedAuction.id] } } });
        await db.selectPoolEntry.delete({ where: { id: poolEntry.id } });
        await db.general.delete({ where: { id: general.id } });
        await db.worldState.delete({ where: { id: row.id } });
    });

    it('reprojects tick-owned dates for a live turn-term change without rewriting existing log timestamps', async () => {
        const base = new Date('2099-08-01T10:00:00.000Z');
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'runtime-game-settings',
                currentYear: 191,
                currentMonth: 2,
                tickSeconds: 600,
                clockBaseTime: base,
                clockTick: 0,
                clockMode: 'manual',
                clockPhase: 'MANUAL',
                clockWallAnchor: base,
                lastTurnTick: 0,
                config: { turnTermMinutes: 10, blockGeneralCreate: 0 },
                meta: { lastTurnTime: base.toISOString(), turnterm: 10 },
            },
        });
        const general = {
            ...buildGeneral(generalIds[2], new Date('2099-08-01T10:10:00.000Z')),
            turnTick: GAME_TICKS_PER_TURN,
            recentWarTime: new Date('2099-08-01T10:05:00.000Z'),
            recentWarTick: GAME_TICKS_PER_TURN / 2,
        };
        await db.general.create({
            data: {
                id: general.id,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                troopId: general.troopId,
                turnTime: general.turnTime,
                turnTick: BigInt(general.turnTick),
                recentWarTime: general.recentWarTime,
                recentWarTick: BigInt(general.recentWarTick),
            },
        });
        const auction = await db.auction.create({
            data: {
                type: 'BUY_RICE',
                hostGeneralId: general.id,
                detail: {},
                status: 'OPEN',
                closeAt: new Date('2099-08-01T10:10:00.000Z'),
                closeTick: BigInt(GAME_TICKS_PER_TURN),
            },
        });
        const message = await db.message.create({
            data: {
                mailbox: general.id,
                type: 'runtime-settings-test',
                src: 0,
                dest: general.id,
                time: new Date('2099-08-01T10:05:00.000Z'),
                timeTick: BigInt(GAME_TICKS_PER_TURN / 2),
                validUntil: new Date('2099-08-01T10:10:00.000Z'),
                validUntilTick: BigInt(GAME_TICKS_PER_TURN),
                message: {},
            },
        });
        const vote = await db.votePoll.create({
            data: {
                title: 'runtime settings test',
                options: ['yes', 'no'],
                revealMode: 'ALWAYS',
                openerGeneralId: general.id,
                openerName: general.name,
                startAt: new Date('2099-08-01T10:05:00.000Z'),
                startTick: BigInt(GAME_TICKS_PER_TURN / 2),
                endAt: new Date('2099-08-01T10:10:00.000Z'),
                endTick: BigInt(GAME_TICKS_PER_TURN),
            },
        });
        const originalLogTime = new Date('2026-01-02T03:04:05.000Z');
        const existingLog = await db.logEntry.create({
            data: {
                scope: 'SYSTEM',
                category: 'HISTORY',
                year: 191,
                month: 2,
                text: runtimeSettingsLogText,
                createdAt: originalLogTime,
            },
        });

        const state: TurnWorldState = {
            id: row.id,
            currentYear: 191,
            currentMonth: 2,
            tickSeconds: 600,
            lastTurnTime: base,
            clockBaseTime: base,
            clockTick: 0,
            clockMode: 'manual',
            clockWallAnchor: base,
            lastTurnTick: 0,
            meta: row.meta as Record<string, unknown>,
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
            worldConfig: row.config as Record<string, unknown>,
            map: {
                id: 'test',
                name: 'test',
                cities: [],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            },
            generals: [general],
            cities: [],
            nations: [],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        const stateStore = new InMemoryTurnStateStore(world);
        await stateStore.saveCheckpoint({
            turnTime: base.toISOString(),
            turnTick: 0,
            generalId: 0,
            year: 191,
            month: 2,
        });
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        const queue = new DatabaseTurnDaemonCommandQueue(db);
        await queue.initialize();
        const stateManager = new EngineStateManager();
        stateManager.register('world', {
            capture: () => world.captureState(),
            restore: (saved) => world.restoreState(saved),
        });
        const lifecycle = new TurnDaemonLifecycle(
            {
                clock: new SystemClock(),
                controlQueue: queue,
                commandResponder: queue,
                commandHandler: createTurnDaemonCommandHandler({ world }),
                hooks: hooks.hooks,
                stateManager,
                stateStore,
                getNextTickTime: (lastTurnTime) =>
                    getNextTickTime(lastTurnTime, Math.max(1, Math.round(world.getState().tickSeconds / 60))),
                processor: {
                    run: async () => ({
                        lastTurnTime: world.getState().lastTurnTime.toISOString(),
                        processedGenerals: 0,
                        processedTurns: 0,
                        durationMs: 0,
                        partial: false,
                    }),
                },
            },
            {
                profile: 'integration',
                defaultBudget: { budgetMs: 1000, maxGenerals: 10, catchUpCap: 1 },
            }
        );

        await db.inputEvent.create({
            data: {
                requestId: runtimeSettingsRequestId,
                target: 'ENGINE',
                eventType: 'updateRuntimeSettings',
                payload: {
                    type: 'updateRuntimeSettings',
                    requestId: runtimeSettingsRequestId,
                    actionId: runtimeSettingsActionId,
                    settings: {
                        turnTermMinutes: 20,
                        blockGeneralCreate: 2,
                        autorunUser: {
                            limitMinutes: 720,
                            options: ['develop', 'recruit_high', 'chief'],
                        },
                    },
                } as GamePrisma.InputJsonValue,
            },
        });
        const loop = lifecycle.start();
        try {
            await waitForSucceeded(db, runtimeSettingsRequestId);
        } finally {
            await lifecycle.stop('test complete');
            await loop;
            await hooks.close();
        }

        const storedWorld = await db.worldState.findUniqueOrThrow({ where: { id: row.id } });
        expect(storedWorld).toMatchObject({ tickSeconds: 1200, clockBaseTime: base, lastTurnTick: 0n });
        expect(storedWorld.config).toMatchObject({ turnTermMinutes: 20, blockGeneralCreate: 2 });
        expect(storedWorld.meta).toMatchObject({
            turnterm: 20,
            autorun_user: {
                limit_minutes: 720,
                options: { develop: true, recruit_high: true, chief: true },
            },
        });
        expect(await db.general.findUniqueOrThrow({ where: { id: general.id } })).toMatchObject({
            turnTime: new Date('2099-08-01T10:20:00.000Z'),
            turnTick: BigInt(GAME_TICKS_PER_TURN),
            recentWarTime: new Date('2099-08-01T10:10:00.000Z'),
        });
        expect((await db.auction.findUniqueOrThrow({ where: { id: auction.id } })).closeAt).toEqual(
            new Date('2099-08-01T10:20:00.000Z')
        );
        expect(await db.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
            time: new Date('2099-08-01T10:10:00.000Z'),
            validUntil: new Date('2099-08-01T10:20:00.000Z'),
        });
        expect(await db.votePoll.findUniqueOrThrow({ where: { id: vote.id } })).toMatchObject({
            startAt: new Date('2099-08-01T10:10:00.000Z'),
            endAt: new Date('2099-08-01T10:20:00.000Z'),
        });
        expect(await db.logEntry.findUniqueOrThrow({ where: { id: existingLog.id } })).toMatchObject({
            text: runtimeSettingsLogText,
            createdAt: originalLogTime,
        });
        expect(await db.logEntry.findFirst({ where: { text: { contains: '턴시간이 <C>20분' } } })).not.toBeNull();
        expect(lifecycle.getStatus().nextTurnTime).toBe('2099-08-01T10:20:00.000Z');
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId: runtimeSettingsRequestId } })).toMatchObject(
            {
                status: 'SUCCEEDED',
                result: {
                    type: 'updateRuntimeSettings',
                    ok: true,
                    actionId: runtimeSettingsActionId,
                    termChanged: true,
                    previousTurnTermMinutes: 10,
                    turnTermMinutes: 20,
                    shiftedGenerals: 1,
                    reprojectedAuctions: 1,
                    reprojectedMessages: 1,
                    reprojectedVotes: 1,
                },
            }
        );
    });
});
