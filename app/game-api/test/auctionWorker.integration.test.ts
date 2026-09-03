import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { createAuctionFinalizer } from '@sammo-ts/game-engine/auction/finalizer.js';
import { createTurnDaemonCommandHandler } from '@sammo-ts/game-engine/turn/worldCommandHandler.js';
import { createGamePostgresConnector, createRedisConnector, resolveRedisConfigFromEnv } from '@sammo-ts/infra';
import type { GamePrisma } from '@sammo-ts/infra';
import type { MapDefinition, ScenarioConfig, ScenarioMeta, TurnSchedule } from '@sammo-ts/logic';

import { buildAuctionTimerKeys } from '../src/auction/keys.js';
import { buildAuctionFinalizeRequestId, processDueAuctionId, runAuctionWorker } from '../src/auction/worker.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const liveDescribe = databaseUrl && process.env.REDIS_URL ? describe : describe.skip;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

liveDescribe('auction worker durable recovery', () => {
    const connector = createGamePostgresConnector({ url: databaseUrl! });
    const createdAuctionIds: number[] = [];
    const createdRequestPrefixes: string[] = [];
    const createdWorldIds: number[] = [];
    const createdGeneralIds: number[] = [];
    const lifecycleUserIds = ['auction-durable-host', 'auction-durable-bidder'];

    beforeAll(async () => {
        await connector.connect();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    afterAll(async () => {
        if (createdRequestPrefixes.length > 0) {
            await connector.prisma.inputEvent.deleteMany({
                where: { OR: createdRequestPrefixes.map((prefix) => ({ requestId: { startsWith: prefix } })) },
            });
        }
        if (createdAuctionIds.length > 0) {
            await connector.prisma.auction.deleteMany({ where: { id: { in: createdAuctionIds } } });
        }
        if (createdWorldIds.length > 0) {
            await connector.prisma.worldState.deleteMany({ where: { id: { in: createdWorldIds } } });
        }
        if (createdGeneralIds.length > 0) {
            await connector.prisma.message.deleteMany({ where: { mailbox: { in: createdGeneralIds } } });
            await connector.prisma.webPushOutbox.deleteMany({ where: { userIds: { hasSome: lifecycleUserIds } } });
            await connector.prisma.logEntry.deleteMany({ where: { generalId: { in: createdGeneralIds } } });
            await connector.prisma.general.deleteMany({ where: { id: { in: createdGeneralIds } } });
        }
        await connector.disconnect();
    });

    const createAuction = async (status: 'OPEN' | 'FINALIZING', closeAt = new Date(Date.now() - 60_000)) => {
        const auction = await connector.prisma.auction.create({
            data: {
                type: 'BUY_RICE',
                hostGeneralId: 0,
                hostName: 'worker-test',
                detail: { amount: 100 },
                status,
                closeAt,
                ...(status === 'FINALIZING' ? { finalizingAt: new Date(Date.now() - 30_000) } : {}),
            },
        });
        createdAuctionIds.push(auction.id);
        createdRequestPrefixes.push(`auction:finalize:${auction.id}:`);
        return auction;
    };

    const requestIdFor = (auction: { id: number; closeAt: Date; closeTick?: bigint | null }): string =>
        buildAuctionFinalizeRequestId(auction.id, {
            closeAt: auction.closeAt,
            closeTick: auction.closeTick ?? null,
        });

    const memoryRedis = () => ({
        zRangeByScore: vi.fn(async () => []),
        zRangeWithScores: vi.fn(async () => []),
        zAdd: vi.fn(async () => 1),
        zRem: vi.fn(async () => 0),
        zRemRangeByScore: vi.fn(async () => 0),
    });

    it('leaves OPEN and creates one deterministic input event', async () => {
        const auction = await createAuction('OPEN');
        const redis = memoryRedis();

        await expect(
            processDueAuctionId({
                db: connector.prisma,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: String(auction.id),
                nowMs: Date.now(),
            })
        ).resolves.toBe('PENDING');
        await expect(
            processDueAuctionId({
                db: connector.prisma,
                redis,
                timerKey: 'timer',
                historyKey: 'history',
                id: String(auction.id),
                nowMs: Date.now(),
            })
        ).resolves.toBe('PENDING');

        const [storedAuction, events] = await Promise.all([
            connector.prisma.auction.findUniqueOrThrow({ where: { id: auction.id } }),
            connector.prisma.inputEvent.findMany({ where: { requestId: requestIdFor(auction) } }),
        ]);
        expect(storedAuction.status).toBe('OPEN');
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            target: 'ENGINE',
            eventType: 'auctionFinalize',
            status: 'PENDING',
            payload: {
                type: 'auctionFinalize',
                requestId: requestIdFor(auction),
                auctionId: auction.id,
                expectedCloseAt: auction.closeAt.toISOString(),
            },
        });
    });

    it('rolls the OPEN transition back when the deterministic request ID conflicts', async () => {
        const auction = await createAuction('OPEN');
        const requestId = requestIdFor(auction);
        await connector.prisma.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'getStatus',
                payload: { type: 'getStatus', requestId },
            },
        });

        await expect(
            processDueAuctionId({
                db: connector.prisma,
                redis: memoryRedis(),
                timerKey: 'timer',
                historyKey: 'history',
                id: String(auction.id),
                nowMs: Date.now(),
            })
        ).rejects.toThrow(`Conflicting durable auction finalization event: ${requestId}`);

        await expect(connector.prisma.auction.findUniqueOrThrow({ where: { id: auction.id } })).resolves.toMatchObject({
            status: 'OPEN',
            finalizingAt: null,
        });
        await connector.prisma.inputEvent.delete({ where: { requestId } });
        await connector.prisma.auction.delete({ where: { id: auction.id } });
    });

    it('creates one bounded recovery event after terminal failure and then stops retrying', async () => {
        const auction = await createAuction('FINALIZING');
        const requestId = requestIdFor(auction);
        const retryRequestId = `${requestId}:retry:1`;
        await connector.prisma.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'auctionFinalize',
                payload: { type: 'auctionFinalize', requestId, auctionId: auction.id },
                status: 'FAILED',
                attempts: 3,
                error: 'simulated terminal failure',
                completedAt: new Date(),
            },
        });

        await expect(
            processDueAuctionId({
                db: connector.prisma,
                redis: memoryRedis(),
                timerKey: 'timer',
                historyKey: 'history',
                id: String(auction.id),
                nowMs: Date.now(),
            })
        ).resolves.toBe('PENDING');
        await expect(
            processDueAuctionId({
                db: connector.prisma,
                redis: memoryRedis(),
                timerKey: 'timer',
                historyKey: 'history',
                id: String(auction.id),
                nowMs: Date.now(),
            })
        ).resolves.toBe('PENDING');
        await expect(
            connector.prisma.inputEvent.findMany({
                where: { requestId: { startsWith: requestId } },
                orderBy: { sequence: 'asc' },
            })
        ).resolves.toEqual([
            expect.objectContaining({ requestId, status: 'FAILED' }),
            expect.objectContaining({ requestId: retryRequestId, status: 'PENDING', attempts: 0 }),
        ]);

        await connector.prisma.inputEvent.update({
            where: { requestId: retryRequestId },
            data: { status: 'FAILED', attempts: 3, error: 'simulated recovery failure', completedAt: new Date() },
        });
        await expect(
            processDueAuctionId({
                db: connector.prisma,
                redis: memoryRedis(),
                timerKey: 'timer',
                historyKey: 'history',
                id: String(auction.id),
                nowMs: Date.now(),
            })
        ).rejects.toThrow(`Auction finalization recovery exhausted: ${auction.id}`);
    });

    it('creates a new generation after an earlier close was extended', async () => {
        const auction = await createAuction('OPEN');
        const priorRequestId = `auction:finalize:${auction.id}:${auction.closeAt.getTime() - 300_000}`;
        await connector.prisma.inputEvent.create({
            data: {
                requestId: priorRequestId,
                target: 'ENGINE',
                eventType: 'auctionFinalize',
                payload: { type: 'auctionFinalize', requestId: priorRequestId, auctionId: auction.id },
                status: 'SUCCEEDED',
                attempts: 1,
                result: {
                    type: 'auctionFinalize',
                    ok: false,
                    auctionId: auction.id,
                    reason: 'extended',
                },
                completedAt: new Date(),
            },
        });

        await expect(
            processDueAuctionId({
                db: connector.prisma,
                redis: memoryRedis(),
                timerKey: 'timer',
                historyKey: 'history',
                id: String(auction.id),
                nowMs: Date.now(),
            })
        ).resolves.toBe('PENDING');

        await expect(
            connector.prisma.inputEvent.findUnique({ where: { requestId: requestIdFor(auction) } })
        ).resolves.toMatchObject({ status: 'PENDING', eventType: 'auctionFinalize' });
    });

    it(
        'flows the durable event through the actual daemon finalizer and reloads one FINISHED settlement',
        { timeout: 15_000 },
        async () => {
            const worldId = 992_031;
            const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
            const scenarioMeta: ScenarioMeta = {
                title: '경매 durable lifecycle 통합',
                startYear: 190,
                life: null,
                fiction: null,
                history: [],
                ignoreDefaultEvents: false,
            };
            const scenarioConfig: ScenarioConfig = {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 65 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'che', unitSet: 'che' },
            };
            const map: MapDefinition = { id: 'auction-durable-lifecycle', name: scenarioMeta.title, cities: [] };
            const state: TurnWorldState = {
                id: worldId,
                currentYear: 190,
                currentMonth: 1,
                tickSeconds: 600,
                lastTurnTime: new Date('2026-07-31T11:00:00.000Z'),
                clockBaseTime: new Date('2026-07-31T11:00:00.000Z'),
                clockTick: 0,
                clockMode: 'realtime',
                clockWallAnchor: new Date('2026-07-31T11:00:00.000Z'),
                lastTurnTick: 0,
                clockPhase: 'RUNNING',
                clockRevision: 1,
                deadlineGeneration: 1,
                meta: { killturn: 24, scenarioMeta },
            };
            const buildGeneral = (options: {
                id: number;
                userId: string;
                name: string;
                gold: number;
                rice: number;
            }): TurnGeneral => ({
                id: options.id,
                userId: options.userId,
                name: options.name,
                nationId: 0,
                cityId: 0,
                troopId: 0,
                stats: { leadership: 50, strength: 50, intelligence: 50 },
                turnTime: new Date('2026-07-31T12:00:00.000Z'),
                recentWarTime: null,
                role: {
                    items: { horse: null, weapon: null, book: null, item: null },
                    personality: null,
                    specialDomestic: null,
                    specialWar: null,
                },
                triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
                meta: { killturn: 24 },
                penalty: {},
                officerLevel: 0,
                experience: 0,
                dedication: 0,
                injury: 0,
                gold: options.gold,
                rice: options.rice,
                crew: 0,
                crewTypeId: 0,
                train: 0,
                atmos: 0,
                age: 20,
                npcState: 0,
                picture: 'default.jpg',
                imageServer: 0,
            });
            const host = buildGeneral({
                id: 8_032,
                userId: 'auction-durable-host',
                name: '경매주최자',
                gold: 1_000,
                rice: 900,
            });
            const bidder = buildGeneral({
                id: 8_033,
                userId: 'auction-durable-bidder',
                name: '경매입찰자',
                gold: 800,
                rice: 1_000,
            });
            const snapshot: TurnWorldSnapshot = {
                generals: [host, bidder],
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

            const lifecycleGeneralIds = [8_032, 8_033];
            await connector.prisma.message.deleteMany({ where: { mailbox: { in: lifecycleGeneralIds } } });
            await connector.prisma.webPushOutbox.deleteMany({ where: { userIds: { hasSome: lifecycleUserIds } } });
            await connector.prisma.logEntry.deleteMany({ where: { generalId: { in: lifecycleGeneralIds } } });
            await connector.prisma.general.deleteMany({ where: { id: { in: lifecycleGeneralIds } } });
            await connector.prisma.worldState.deleteMany({ where: { id: worldId } });
            await connector.prisma.worldState.create({
                data: {
                    id: worldId,
                    scenarioCode: map.id,
                    currentYear: state.currentYear,
                    currentMonth: state.currentMonth,
                    tickSeconds: state.tickSeconds,
                    clockBaseTime: state.clockBaseTime,
                    clockTick: BigInt(state.clockTick ?? 0),
                    clockMode: state.clockMode ?? 'realtime',
                    clockWallAnchor: state.clockWallAnchor,
                    lastTurnTick: BigInt(state.lastTurnTick ?? 0),
                    clockPhase: state.clockPhase ?? 'RUNNING',
                    clockRevision: BigInt(state.clockRevision ?? 1),
                    deadlineGeneration: BigInt(state.deadlineGeneration ?? 1),
                    config: JSON.parse(JSON.stringify(scenarioConfig)) as GamePrisma.InputJsonValue,
                    meta: state.meta as GamePrisma.InputJsonValue,
                },
            });
            createdWorldIds.push(worldId);
            for (const general of [host, bidder]) {
                await connector.prisma.general.create({
                    data: {
                        id: general.id,
                        userId: general.userId,
                        name: general.name,
                        turnTime: general.turnTime,
                        gold: general.gold,
                        rice: general.rice,
                        picture: general.picture,
                        imageServer: general.imageServer,
                        meta: general.meta,
                    },
                });
                createdGeneralIds.push(general.id);
            }
            const logicalPastCloseAt = new Date(state.lastTurnTime.getTime() - 60_000);
            const auction = await createAuction('OPEN', logicalPastCloseAt);
            await connector.prisma.auction.update({
                where: { id: auction.id },
                data: { hostGeneralId: host.id, hostName: host.name },
            });
            await connector.prisma.auctionBid.create({
                data: {
                    auctionId: auction.id,
                    generalId: bidder.id,
                    amount: 200,
                    eventId: `auction-durable-bid:${auction.id}`,
                    eventAt: new Date(),
                },
            });
            const requestId = requestIdFor(auction);
            await processDueAuctionId({
                db: connector.prisma,
                redis: memoryRedis(),
                timerKey: 'timer',
                historyKey: 'history',
                id: String(auction.id),
                nowMs: Date.now(),
            });

            const world = new InMemoryTurnWorld(state, snapshot, { schedule });
            const queue = new DatabaseTurnDaemonCommandQueue(connector.prisma);
            await queue.initialize();
            const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
            const auctionFinalizer = await createAuctionFinalizer({ databaseUrl: databaseUrl!, world });
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
                            throw new Error('scheduled turn must not run in auction lifecycle integration');
                        },
                    },
                    commandHandler: createTurnDaemonCommandHandler({ world, auctionFinalizer }),
                    hooks: hooks.hooks,
                    stateManager,
                },
                {
                    profile: 'auction-durable-lifecycle',
                    defaultBudget: { budgetMs: 100, maxGenerals: 1, catchUpCap: 1 },
                }
            );
            const waitForSettlement = async () => {
                for (let attempt = 0; attempt < 200; attempt += 1) {
                    const [event, storedAuction] = await Promise.all([
                        connector.prisma.inputEvent.findUnique({ where: { requestId } }),
                        connector.prisma.auction.findUnique({ where: { id: auction.id } }),
                    ]);
                    if (event?.status === 'SUCCEEDED' && storedAuction?.status === 'FINISHED') {
                        return { event, storedAuction };
                    }
                    await delay(25);
                }
                throw new Error(`Timed out waiting for auction ${auction.id} settlement`);
            };
            let extensionAuctionId: number;

            let loop: Promise<void> | undefined;
            try {
                loop = lifecycle.start();
                await expect(waitForSettlement()).resolves.toMatchObject({
                    event: {
                        attempts: 1,
                        result: { type: 'auctionFinalize', ok: true, auctionId: auction.id },
                    },
                    storedAuction: { status: 'FINISHED' },
                });

                const extensionAuction = await connector.prisma.auction.create({
                    data: {
                        type: 'UNIQUE_ITEM',
                        targetCode: 'integration-invalid-unique-item',
                        hostGeneralId: 0,
                        hostName: '(상인)',
                        detail: { remainCloseDateExtensionCnt: 1 },
                        status: 'OPEN',
                        closeAt: logicalPastCloseAt,
                    },
                });
                extensionAuctionId = extensionAuction.id;
                createdAuctionIds.push(extensionAuction.id);
                createdRequestPrefixes.push(`auction:finalize:${extensionAuction.id}:`);
                await connector.prisma.auctionBid.create({
                    data: {
                        auctionId: extensionAuction.id,
                        generalId: bidder.id,
                        amount: 50,
                        eventId: `auction-extension-bid:${extensionAuction.id}`,
                        eventAt: new Date(),
                        meta: { tryExtendCloseDate: true },
                    },
                });
                const firstExtensionRequestId = requestIdFor(extensionAuction);
                await processDueAuctionId({
                    db: connector.prisma,
                    redis: memoryRedis(),
                    timerKey: 'timer',
                    historyKey: 'history',
                    id: String(extensionAuction.id),
                    nowMs: Date.now(),
                });

                let reopened: { status: string; closeAt: Date } | null = null;
                for (let attempt = 0; attempt < 200; attempt += 1) {
                    const [event, storedAuction] = await Promise.all([
                        connector.prisma.inputEvent.findUnique({ where: { requestId: firstExtensionRequestId } }),
                        connector.prisma.auction.findUnique({ where: { id: extensionAuction.id } }),
                    ]);
                    if (event?.status === 'SUCCEEDED' && storedAuction?.status === 'OPEN') {
                        reopened = storedAuction;
                        break;
                    }
                    await delay(25);
                }
                expect(reopened).toMatchObject({ status: 'OPEN' });
                expect(reopened!.closeAt.getTime()).toBeGreaterThan(extensionAuction.closeAt.getTime());

                const secondGameNow = world.getGameNow(new Date());
                const secondCloseAt = new Date(secondGameNow.getTime() - 1_000);
                const secondCloseTick = world.dateToGameTick(secondCloseAt);
                await connector.prisma.auction.update({
                    where: { id: extensionAuction.id },
                    data: { closeAt: secondCloseAt, closeTick: BigInt(secondCloseTick) },
                });
                const secondExtensionRequestId = requestIdFor({
                    id: extensionAuction.id,
                    closeAt: secondCloseAt,
                    closeTick: BigInt(secondCloseTick),
                });
                await processDueAuctionId({
                    db: connector.prisma,
                    redis: memoryRedis(),
                    timerKey: 'timer',
                    historyKey: 'history',
                    id: String(extensionAuction.id),
                    nowMs: secondGameNow.getTime(),
                    nowTick: world.dateToGameTick(secondGameNow),
                });

                for (let attempt = 0; attempt < 200; attempt += 1) {
                    const [event, storedAuction] = await Promise.all([
                        connector.prisma.inputEvent.findUnique({ where: { requestId: secondExtensionRequestId } }),
                        connector.prisma.auction.findUnique({ where: { id: extensionAuction.id } }),
                    ]);
                    if (event?.status === 'SUCCEEDED' && storedAuction?.status === 'CANCELED') break;
                    await delay(25);
                }
                const secondExtensionEvent = await connector.prisma.inputEvent.findUniqueOrThrow({
                    where: { requestId: secondExtensionRequestId },
                });
                expect(secondExtensionEvent).toMatchObject({ status: 'SUCCEEDED', error: null });
                expect(secondExtensionEvent.result).toEqual({
                    type: 'auctionFinalize',
                    ok: false,
                    auctionId: extensionAuction.id,
                    reason: '아이템 키가 올바르지 않습니다.',
                });
                await expect(
                    connector.prisma.auction.findUniqueOrThrow({ where: { id: extensionAuction.id } })
                ).resolves.toMatchObject({ status: 'CANCELED' });
                await expect(
                    connector.prisma.inputEvent.count({
                        where: { requestId: { startsWith: `auction:finalize:${extensionAuction.id}:` } },
                    })
                ).resolves.toBe(2);
            } finally {
                await lifecycle.stop('auction durable lifecycle integration finished');
                await loop;
                await auctionFinalizer.close();
                await hooks.close();
            }

            const freshConnector = createGamePostgresConnector({ url: databaseUrl! });
            await freshConnector.connect();
            try {
                await expect(
                    freshConnector.prisma.auction.findUniqueOrThrow({ where: { id: auction.id } })
                ).resolves.toMatchObject({ status: 'FINISHED' });
                await expect(
                    freshConnector.prisma.inputEvent.count({
                        where: { requestId: { startsWith: `auction:finalize:${auction.id}:` } },
                    })
                ).resolves.toBe(1);
                await expect(
                    freshConnector.prisma.logEntry.count({
                        where: { generalId: { in: [host.id, bidder.id] } },
                    })
                ).resolves.toBe(2);
                await expect(
                    freshConnector.prisma.auction.findUniqueOrThrow({ where: { id: extensionAuctionId } })
                ).resolves.toMatchObject({ status: 'CANCELED' });
            } finally {
                await freshConnector.disconnect();
            }
            const reloaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
            expect(reloaded.snapshot.generals.find((general) => general.id === host.id)).toMatchObject({
                gold: 1_200,
                rice: 900,
            });
            expect(reloaded.snapshot.generals.find((general) => general.id === bidder.id)).toMatchObject({
                gold: 800,
                rice: 1_100,
            });
        }
    );

    it(
        'restarts from a stranded FINALIZING row, creates its event, and stops cleanly',
        { timeout: 15_000 },
        async () => {
            const poisonedAuction = await createAuction('OPEN');
            await connector.prisma.auction.update({
                where: { id: poisonedAuction.id },
                data: { closeTick: 0n },
            });
            const poisonedRequestId = requestIdFor(poisonedAuction);
            await connector.prisma.inputEvent.create({
                data: {
                    requestId: poisonedRequestId,
                    target: 'ENGINE',
                    eventType: 'getStatus',
                    payload: { type: 'getStatus', requestId: poisonedRequestId },
                },
            });
            const auction = await createAuction('FINALIZING');
            const schema = new URL(databaseUrl!).searchParams.get('schema');
            if (!schema) throw new Error('integration database URL must include a schema');
            const profileName = `auction-recovery:${randomUUID()}`;
            vi.stubEnv('DATABASE_URL', databaseUrl!);
            vi.stubEnv('PROFILE', schema);
            vi.stubEnv('SCENARIO', 'worker-recovery');
            vi.stubEnv('GAME_PROFILE_NAME', profileName);
            vi.stubEnv('GAME_TOKEN_SECRET', 'auction-worker-integration-only');
            vi.stubEnv('AUCTION_TIMER_POLL_MS', '25');
            vi.stubEnv('AUCTION_TIMER_RESYNC_MS', '50');

            const redisConnector = createRedisConnector(resolveRedisConfigFromEnv());
            await redisConnector.connect();
            const keys = buildAuctionTimerKeys(profileName);
            const abortController = new AbortController();
            const worker = runAuctionWorker({ signal: abortController.signal });

            try {
                const deadline = Date.now() + 5_000;
                let event = null;
                while (Date.now() < deadline) {
                    event = await connector.prisma.inputEvent.findUnique({
                        where: { requestId: requestIdFor(auction) },
                    });
                    if (event) break;
                    await delay(25);
                }
                expect(event).toMatchObject({
                    status: 'PENDING',
                    eventType: 'auctionFinalize',
                });
                expect(await redisConnector.client.zScore(keys.historyKey, String(auction.id))).not.toBeNull();
                expect(
                    await connector.prisma.errorLog.count({
                        where: {
                            source: 'auction-worker',
                            message: { contains: poisonedRequestId },
                        },
                    })
                ).toBeGreaterThan(0);
            } finally {
                abortController.abort();
                await worker;
                await redisConnector.client.del([keys.timerKey, keys.historyKey]);
                await redisConnector.disconnect();
                await connector.prisma.errorLog.deleteMany({
                    where: {
                        source: 'auction-worker',
                        message: { contains: poisonedRequestId },
                    },
                });
            }
        }
    );
});
