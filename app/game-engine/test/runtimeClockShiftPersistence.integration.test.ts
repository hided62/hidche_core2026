import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';
import { GAME_TICKS_PER_TURN } from '@sammo-ts/common';
import { SystemClock } from '../src/lifecycle/clock.js';
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
const generalIds = [990_301, 990_302] as const;

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

const waitForSucceeded = async (db: GamePrismaClient): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const event = await db.inputEvent.findUnique({ where: { requestId }, select: { status: true } });
        if (event?.status === 'SUCCEEDED') {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('runtime clock shift input event did not complete');
};

integration('runtime clock shift persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.inputEvent.deleteMany({ where: { requestId } });
        await db.auction.deleteMany({ where: { hostGeneralId: { in: [...generalIds] } } });
        await db.general.deleteMany({ where: { id: { in: [...generalIds] } } });
        await db.worldState.deleteMany({ where: { scenarioCode: 'runtime-clock-shift' } });
    });

    afterAll(async () => {
        await db.inputEvent.deleteMany({ where: { requestId } });
        await db.auction.deleteMany({ where: { hostGeneralId: { in: [...generalIds] } } });
        await db.general.deleteMany({ where: { id: { in: [...generalIds] } } });
        await db.worldState.deleteMany({ where: { scenarioCode: 'runtime-clock-shift' } });
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
                        hostGeneralId: generalIds[index % generalIds.length]!,
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
});
