import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TurnDaemonCommand } from '@sammo-ts/common';
import { createGamePostgresConnector } from '@sammo-ts/infra';
import type { GamePrisma, GamePrismaClient } from '@sammo-ts/infra';

import { DatabaseTurnDaemonCommandQueue } from '../src/lifecycle/databaseCommandQueue.js';
import type { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration('database command queue', () => {
    let close: (() => Promise<void>) | undefined;
    let db: GamePrismaClient;

    const cleanupFixtures = async (): Promise<void> => {
        await db.inputEvent.deleteMany({ where: { requestId: { startsWith: 'integration:engine:' } } });
        await db.clockProjectionOutbox.deleteMany({
            where: {
                suspensionId: {
                    in: [
                        'integration-queue-revision-8-9',
                        'integration-maintenance-suspension',
                        'integration-unification-wait',
                    ],
                },
            },
        });
        await db.clockSuspension.deleteMany({
            where: {
                id: {
                    in: [
                        'integration-queue-revision-8-9',
                        'integration-maintenance-suspension',
                        'integration-unification-wait',
                    ],
                },
            },
        });
        await db.message.deleteMany({ where: { mailbox: 991_199 } });
        await db.worldState.deleteMany({
            where: { scenarioCode: { in: ['queue-clock-base', 'queue-clock-test', 'queue-unification-clock-test'] } },
        });
    };

    const createClockFixture = async (): Promise<void> => {
        await db.worldState.create({
            data: {
                scenarioCode: 'queue-clock-base',
                currentYear: 180,
                currentMonth: 1,
                tickSeconds: 600,
                clockBaseTime: new Date('0180-01-01T00:00:00.000Z'),
                clockTick: 123n,
                clockMode: 'manual',
                clockWallAnchor: new Date('2026-09-03T15:00:00.000Z'),
                lastTurnTick: 123n,
                clockPhase: 'MANUAL',
                clockRevision: 1n,
                deadlineGeneration: 1n,
            },
        });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
        await db.inputEvent.deleteMany({
            where: { requestId: { startsWith: 'integration:engine:' } },
        });
    });

    beforeEach(async () => {
        await cleanupFixtures();
        await createClockFixture();
    });

    afterAll(async () => {
        await cleanupFixtures();
        await close?.();
    });

    it('claims one durable event only once across concurrent consumers and persists its result', async () => {
        const requestId = 'integration:engine:claim-once';
        await db.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'vacation',
                actorUserId: 'user-7',
                payload: { type: 'vacation', requestId, userId: 'user-7', generalId: 7 } as GamePrisma.InputJsonValue,
            },
        });

        const first = new DatabaseTurnDaemonCommandQueue(db);
        const second = new DatabaseTurnDaemonCommandQueue(db);
        const [firstCommands, secondCommands] = await Promise.all([first.drain(), second.drain()]);
        const commands = firstCommands.concat(secondCommands);

        expect(commands).toEqual([
            {
                type: 'vacation',
                requestId,
                userId: 'user-7',
                generalId: 7,
                processingGameTick: 123,
                requestedAtWall: expect.any(Date),
            },
        ]);
        await first.publishCommandResult(requestId, { type: 'vacation', ok: true, generalId: 7 });

        const stored = await db.inputEvent.findUniqueOrThrow({ where: { requestId } });
        expect(stored).toMatchObject({
            status: 'SUCCEEDED',
            attempts: 1,
            result: { type: 'vacation', ok: true, generalId: 7 },
        });
    });

    it('recovers only an expired processing lease', async () => {
        const expiredId = 'integration:engine:expired';
        const activeId = 'integration:engine:active';
        await db.inputEvent.createMany({
            data: [
                {
                    requestId: expiredId,
                    target: 'ENGINE',
                    eventType: 'vacation',
                    actorUserId: 'user-8',
                    payload: {
                        type: 'vacation',
                        requestId: expiredId,
                        userId: 'user-8',
                        generalId: 8,
                    } as GamePrisma.InputJsonValue,
                    status: 'PROCESSING',
                    processingAt: new Date(Date.now() - 120_000),
                    lockedBy: 'dead-worker',
                    leaseUntil: new Date(Date.now() - 60_000),
                },
                {
                    requestId: activeId,
                    target: 'ENGINE',
                    eventType: 'vacation',
                    actorUserId: 'user-9',
                    payload: {
                        type: 'vacation',
                        requestId: activeId,
                        userId: 'user-9',
                        generalId: 9,
                    } as GamePrisma.InputJsonValue,
                    status: 'PROCESSING',
                    processingAt: new Date(),
                    lockedBy: 'active-worker',
                    leaseUntil: new Date(Date.now() + 60_000),
                },
            ],
        });

        const queue = new DatabaseTurnDaemonCommandQueue(db);
        await queue.initialize();
        const commands = await queue.drain();

        expect(commands).toEqual([
            {
                type: 'vacation',
                requestId: expiredId,
                userId: 'user-8',
                generalId: 8,
                processingGameTick: 123,
                requestedAtWall: expect.any(Date),
            },
        ]);
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId: activeId } })).toMatchObject({
            status: 'PROCESSING',
            lockedBy: 'active-worker',
        });
    });

    it('retries an owned command twice and then records a terminal failure', async () => {
        const requestId = 'integration:engine:bounded-failure';
        await db.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'vacation',
                actorUserId: 'user-10',
                payload: {
                    type: 'vacation',
                    requestId,
                    userId: 'user-10',
                    generalId: 10,
                } as GamePrisma.InputJsonValue,
            },
        });

        const owner = new DatabaseTurnDaemonCommandQueue(db);
        const stale = new DatabaseTurnDaemonCommandQueue(db);
        for (const attempt of [1, 2, 3]) {
            await expect(owner.drain()).resolves.toEqual([
                {
                    type: 'vacation',
                    requestId,
                    userId: 'user-10',
                    generalId: 10,
                    processingGameTick: 123,
                    requestedAtWall: expect.any(Date),
                },
            ]);
            await stale.publishCommandError(requestId, new Error('stale worker failure'));
            await expect(db.inputEvent.findUniqueOrThrow({ where: { requestId } })).resolves.toMatchObject({
                status: 'PROCESSING',
                attempts: attempt,
            });

            await owner.publishCommandError(requestId, new Error('injected command failure'));
            await expect(db.inputEvent.findUniqueOrThrow({ where: { requestId } })).resolves.toMatchObject({
                status: attempt < 3 ? 'PENDING' : 'FAILED',
                attempts: attempt,
                error: 'injected command failure',
                lockedBy: null,
                leaseUntil: null,
            });
        }

        await expect(owner.drain()).resolves.toEqual([]);
    });

    it('fails an actor-bound payload that omits userId instead of dispatching it', async () => {
        const requestId = 'integration:engine:missing-user-id';
        await db.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'vacation',
                payload: { type: 'vacation', requestId, generalId: 7 } as GamePrisma.InputJsonValue,
            },
        });

        const queue = new DatabaseTurnDaemonCommandQueue(db);
        await expect(queue.drain()).resolves.toEqual([]);
        await expect(db.inputEvent.findUniqueOrThrow({ where: { requestId } })).resolves.toMatchObject({
            status: 'FAILED',
            error: 'Invalid command payload for vacation',
        });
    });

    it('stores a stale-owner rejection once and never redispatches the exact durable request', async () => {
        const requestId = 'integration:engine:stale-owner-replay';
        const command: TurnDaemonCommand = {
            type: 'vacation',
            requestId,
            userId: 'old-owner',
            generalId: 7,
        };
        await db.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: command.type,
                actorUserId: command.userId,
                payload: command as GamePrisma.InputJsonValue,
            },
        });

        const mutation = vi.fn();
        const world = {
            getGeneralById: vi.fn(() => ({ id: command.generalId, userId: 'new-owner' })),
            updateGeneral: mutation,
            updateNation: mutation,
            createTroop: mutation,
            updateTroop: mutation,
            removeTroop: mutation,
            pushLog: mutation,
            queueMessage: mutation,
        } as unknown as InMemoryTurnWorld;
        const handler = createTurnDaemonCommandHandler({ world });
        const handle = vi.spyOn(handler, 'handle');
        const owner = new DatabaseTurnDaemonCommandQueue(db);

        const claimed = await owner.drain();
        expect(claimed).toEqual([
            {
                ...command,
                processingGameTick: 123,
                requestedAtWall: expect.any(Date),
            },
        ]);
        const result = await db.$transaction((transaction) => handler.handle(claimed[0]!, { db: transaction }));
        expect(result).toMatchObject({
            type: 'commandRejected',
            ok: false,
            commandType: command.type,
        });
        await owner.publishCommandResult(requestId, result!);

        await expect(db.inputEvent.findUniqueOrThrow({ where: { requestId } })).resolves.toMatchObject({
            status: 'SUCCEEDED',
            attempts: 1,
            actorUserId: command.userId,
            eventType: command.type,
            payload: command,
            result,
            lockedBy: null,
            leaseUntil: null,
        });
        await expect(new DatabaseTurnDaemonCommandQueue(db).drain()).resolves.toEqual([]);
        expect(handle).toHaveBeenCalledOnce();
        expect(mutation).not.toHaveBeenCalled();
    });

    it('dequeues gameplay only in an executable phase and records the processing clock generation', async () => {
        const existingWorld = await db.worldState.findFirst({ orderBy: { id: 'asc' } });
        const world = existingWorld
            ? await db.worldState.update({
                  where: { id: existingWorld.id },
                  data: { clockPhase: 'SUSPENDED', clockRevision: 9n, deadlineGeneration: 4n, clockTick: 123n },
              })
            : await db.worldState.create({
                  data: {
                      scenarioCode: 'queue-clock-test',
                      currentYear: 180,
                      currentMonth: 1,
                      tickSeconds: 600,
                      clockPhase: 'SUSPENDED',
                      clockRevision: 9n,
                      deadlineGeneration: 4n,
                      clockTick: 123n,
                  },
              });
        const gameplayId = 'integration:engine:clock-gated-gameplay';
        const statusId = 'integration:engine:clock-gated-status';
        const staleId = 'integration:engine:clock-gated-stale';
        await db.inputEvent.createMany({
            data: [
                {
                    requestId: gameplayId,
                    target: 'ENGINE',
                    eventType: 'vacation',
                    actorUserId: 'user-7',
                    acceptedGameTick: 100n,
                    acceptedClockRevision: 9n,
                    acceptedDeadlineGeneration: 4n,
                    payload: { type: 'vacation', requestId: gameplayId, userId: 'user-7', generalId: 7 },
                },
                {
                    requestId: statusId,
                    target: 'ENGINE',
                    eventType: 'getStatus',
                    acceptedGameTick: 100n,
                    acceptedClockRevision: 9n,
                    acceptedDeadlineGeneration: 4n,
                    payload: { type: 'getStatus', requestId: statusId },
                },
                {
                    requestId: staleId,
                    target: 'ENGINE',
                    eventType: 'vacation',
                    actorUserId: 'user-8',
                    acceptedGameTick: 90n,
                    acceptedClockRevision: 8n,
                    acceptedDeadlineGeneration: 3n,
                    payload: { type: 'vacation', requestId: staleId, userId: 'user-8', generalId: 8 },
                },
            ],
        });
        const queue = new DatabaseTurnDaemonCommandQueue(db);

        expect(await queue.drain()).toEqual([
            {
                type: 'getStatus',
                requestId: statusId,
                processingGameTick: 100,
                requestedAtWall: expect.any(Date),
            },
        ]);
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId: gameplayId } })).toMatchObject({
            status: 'PENDING',
            processingClockRevision: null,
        });
        await db.worldState.update({ where: { id: world.id }, data: { clockPhase: 'RUNNING' } });

        expect(await queue.drain()).toEqual([
            {
                type: 'vacation',
                requestId: gameplayId,
                userId: 'user-7',
                generalId: 7,
                processingGameTick: 100,
                requestedAtWall: expect.any(Date),
            },
        ]);
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId: gameplayId } })).toMatchObject({
            status: 'PROCESSING',
            processingGameTick: 100n,
            processingClockRevision: 9n,
            processingDeadlineGeneration: 4n,
        });
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId: staleId } })).toMatchObject({
            status: 'PENDING',
            processingClockRevision: null,
        });
        await db.clockSuspension.deleteMany({ where: { id: 'integration-queue-revision-8-9' } });
        await db.clockSuspension.create({
            data: {
                id: 'integration-queue-revision-8-9',
                worldStateId: world.id,
                source: 'MAINTENANCE',
                policy: 'EXACT',
                status: 'APPLIED',
                sourceRevision: 8n,
                targetRevision: 9n,
                cutTick: 90n,
                cutWallAt: new Date(),
                resumeWallAt: new Date(),
                rateTicksPerSecond: 60_000,
                gapTicks: 33n,
                shiftTicks: 33n,
                alignedTick: 123n,
            },
        });
        expect(await queue.drain()).toEqual([
            {
                type: 'vacation',
                requestId: staleId,
                userId: 'user-8',
                generalId: 8,
                processingGameTick: 123,
                requestedAtWall: expect.any(Date),
            },
        ]);
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId: staleId } })).toMatchObject({
            status: 'PROCESSING',
            acceptedGameTick: 90n,
            acceptedClockRevision: 8n,
            processingGameTick: 123n,
            processingClockRevision: 9n,
            processingDeadlineGeneration: 4n,
        });
    });

    it('dequeues only tournament bet accounting commands while the game clock is suspended', async () => {
        const existingWorld = await db.worldState.findFirst({ orderBy: { id: 'asc' } });
        const world = existingWorld
            ? await db.worldState.update({
                  where: { id: existingWorld.id },
                  data: { clockPhase: 'SUSPENDED', clockRevision: 19n, deadlineGeneration: 6n, clockTick: 321n },
              })
            : await db.worldState.create({
                  data: {
                      scenarioCode: 'queue-clock-test',
                      currentYear: 180,
                      currentMonth: 1,
                      tickSeconds: 600,
                      clockPhase: 'SUSPENDED',
                      clockRevision: 19n,
                      deadlineGeneration: 6n,
                      clockTick: 321n,
                  },
              });
        const resourceId = 'integration:engine:suspended-tournament-bet-resource';
        const metaId = 'integration:engine:suspended-tournament-bet-meta';
        const rollbackId = 'integration:engine:suspended-tournament-bet-rollback';
        const unrelatedId = 'integration:engine:suspended-resource-adjustment';
        await db.inputEvent.createMany({
            data: [
                {
                    requestId: resourceId,
                    target: 'ENGINE',
                    eventType: 'adjustGeneralResources',
                    payload: {
                        type: 'adjustGeneralResources',
                        requestId: resourceId,
                        reason: 'tournamentBet',
                        adjustments: [{ generalId: 7, goldDelta: -100 }],
                    },
                },
                {
                    requestId: metaId,
                    target: 'ENGINE',
                    eventType: 'adjustGeneralMeta',
                    payload: {
                        type: 'adjustGeneralMeta',
                        requestId: metaId,
                        reason: 'tournamentBet',
                        adjustments: [{ generalId: 7, metaDelta: { betgold: 100 } }],
                    },
                },
                {
                    requestId: rollbackId,
                    target: 'ENGINE',
                    eventType: 'adjustGeneralResources',
                    payload: {
                        type: 'adjustGeneralResources',
                        requestId: rollbackId,
                        reason: 'tournamentBetRollback',
                        adjustments: [{ generalId: 7, goldDelta: 100 }],
                    },
                },
                {
                    requestId: unrelatedId,
                    target: 'ENGINE',
                    eventType: 'adjustGeneralResources',
                    payload: {
                        type: 'adjustGeneralResources',
                        requestId: unrelatedId,
                        reason: 'otherMutation',
                        adjustments: [{ generalId: 7, goldDelta: -100 }],
                    },
                },
            ],
        });

        const queue = new DatabaseTurnDaemonCommandQueue(db);
        await expect(queue.drain()).resolves.toEqual([
            expect.objectContaining({ type: 'adjustGeneralResources', requestId: resourceId, reason: 'tournamentBet' }),
            expect.objectContaining({ type: 'adjustGeneralMeta', requestId: metaId, reason: 'tournamentBet' }),
            expect.objectContaining({
                type: 'adjustGeneralResources',
                requestId: rollbackId,
                reason: 'tournamentBetRollback',
            }),
        ]);
        await expect(db.inputEvent.findUniqueOrThrow({ where: { requestId: resourceId } })).resolves.toMatchObject({
            status: 'PROCESSING',
            processingGameTick: 321n,
            processingClockRevision: 19n,
            processingDeadlineGeneration: 6n,
        });
        await expect(db.inputEvent.findUniqueOrThrow({ where: { requestId: unrelatedId } })).resolves.toMatchObject({
            status: 'PENDING',
            processingClockRevision: null,
        });

        await db.worldState.update({ where: { id: world.id }, data: { clockPhase: 'RECONCILING' } });
        await expect(new DatabaseTurnDaemonCommandQueue(db).drain()).resolves.toEqual([]);
    });

    it('dequeues fenced immediate user mutations during a maintenance suspension', async () => {
        const world = await db.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
        await db.worldState.update({
            where: { id: world.id },
            data: { clockPhase: 'SUSPENDED', clockRevision: 23n, deadlineGeneration: 9n, clockTick: 777n },
        });
        await db.clockSuspension.create({
            data: {
                id: 'integration-maintenance-suspension',
                worldStateId: world.id,
                source: 'MAINTENANCE',
                policy: 'EXACT',
                status: 'SUSPENDED',
                sourceRevision: 23n,
                targetRevision: 24n,
                cutTick: 777n,
                cutWallAt: new Date(),
                rateTicksPerSecond: 60_000,
            },
        });
        const commands: TurnDaemonCommand[] = [
            {
                type: 'inheritanceAction',
                requestId: 'integration:engine:suspended-inheritance',
                userId: 'user-7',
                input: { action: 'buyHiddenBuff', buffType: 'warAvoidRatio', level: 1 },
            },
            {
                type: 'dropItem',
                requestId: 'integration:engine:suspended-drop-item',
                userId: 'user-7',
                generalId: 7,
                itemType: 'weapon',
            },
            {
                type: 'changePermission',
                requestId: 'integration:engine:suspended-permission',
                userId: 'user-7',
                generalId: 7,
                isAmbassador: true,
                targetGeneralIds: [8],
            },
            {
                type: 'appoint',
                requestId: 'integration:engine:suspended-appoint',
                userId: 'user-7',
                generalId: 7,
                destGeneralId: 8,
                destCityId: 1,
                officerLevel: 2,
            },
            {
                type: 'setNationSetting',
                requestId: 'integration:engine:suspended-nation-setting',
                userId: 'user-7',
                generalId: 7,
                nationId: 1,
                mutation: { kind: 'rate', amount: 20 },
            },
            {
                type: 'setNpcPolicy',
                requestId: 'integration:engine:suspended-npc-policy',
                userId: 'user-7',
                generalId: 7,
                nationId: 1,
                expectedUpdatedAt: null,
                mutation: { kind: 'nationPriority', priority: ['develop'] },
            },
            {
                type: 'shiftSchedule',
                requestId: 'integration:engine:suspended-shift-schedule',
                actionId: '00000000-0000-4000-8000-000000000023',
                deltaMinutes: -15,
            },
        ];
        await db.inputEvent.createMany({
            data: commands.map((command) => ({
                requestId: command.requestId!,
                target: 'ENGINE' as const,
                eventType: command.type,
                actorUserId: 'userId' in command ? command.userId : null,
                payload: command as GamePrisma.InputJsonValue,
            })),
        });
        const blockedRequestId = 'integration:engine:suspended-vacation-still-gated';
        await db.inputEvent.create({
            data: {
                requestId: blockedRequestId,
                target: 'ENGINE',
                eventType: 'vacation',
                actorUserId: 'user-7',
                payload: {
                    type: 'vacation',
                    requestId: blockedRequestId,
                    userId: 'user-7',
                    generalId: 7,
                },
            },
        });

        const claimed = await new DatabaseTurnDaemonCommandQueue(db).drain();
        expect(claimed.map(({ type }) => type)).toEqual(commands.map(({ type }) => type));
        for (const command of commands) {
            await expect(
                db.inputEvent.findUniqueOrThrow({ where: { requestId: command.requestId! } })
            ).resolves.toMatchObject({
                status: 'PROCESSING',
                processingGameTick: 777n,
                processingClockRevision: 23n,
                processingDeadlineGeneration: 9n,
            });
        }
        await expect(
            db.inputEvent.findUniqueOrThrow({ where: { requestId: blockedRequestId } })
        ).resolves.toMatchObject({
            status: 'PENDING',
            processingClockRevision: null,
        });
    });

    it('dequeues only the invader decision while an UNIFICATION_WAIT suspension is active', async () => {
        const existingWorld = await db.worldState.findFirst({ orderBy: { id: 'asc' } });
        const world = existingWorld
            ? await db.worldState.update({
                  where: { id: existingWorld.id },
                  data: { clockPhase: 'SUSPENDED', clockRevision: 31n, deadlineGeneration: 7n, clockTick: 900n },
              })
            : await db.worldState.create({
                  data: {
                      scenarioCode: 'queue-unification-clock-test',
                      currentYear: 200,
                      currentMonth: 1,
                      tickSeconds: 600,
                      clockPhase: 'SUSPENDED',
                      clockRevision: 31n,
                      deadlineGeneration: 7n,
                      clockTick: 900n,
                  },
              });
        const message = await db.message.create({
            data: {
                mailbox: 991_199,
                type: 'private',
                src: 0,
                dest: 991_199,
                time: new Date(),
                validUntil: new Date('9999-12-31T00:00:00.000Z'),
                message: { option: { action: 'raiseInvader', used: false } },
            },
        });
        await db.messageAction.create({
            data: {
                messageId: message.id,
                actionType: 'raiseInvader',
                status: 'PENDING',
                createdGameTick: 900n,
                clockRevision: 31n,
                deadlineGeneration: 7n,
            },
        });
        const scoutMessage = await db.message.create({
            data: {
                mailbox: 991_199,
                type: 'private',
                src: 7,
                dest: 991_199,
                time: new Date(),
                validUntil: new Date('9999-12-31T00:00:00.000Z'),
                message: { option: { action: 'scout', used: false } },
            },
        });
        await db.messageAction.create({
            data: {
                messageId: scoutMessage.id,
                actionType: 'scout',
                status: 'PENDING',
                createdGameTick: 900n,
                clockRevision: 31n,
                deadlineGeneration: 7n,
            },
        });
        await db.clockSuspension.create({
            data: {
                id: 'integration-unification-wait',
                worldStateId: world.id,
                source: 'UNIFICATION_WAIT',
                policy: 'EXACT',
                status: 'SUSPENDED',
                sourceRevision: 31n,
                targetRevision: 32n,
                cutTick: 900n,
                cutWallAt: new Date(),
                rateTicksPerSecond: 60_000,
            },
        });
        const messageRequestId = 'integration:engine:unification-message';
        const scoutRequestId = 'integration:engine:suspended-scout-response';
        const gameplayRequestId = 'integration:engine:unification-gameplay';
        await db.inputEvent.createMany({
            data: [
                {
                    requestId: messageRequestId,
                    target: 'ENGINE',
                    eventType: 'messageRespond',
                    actorUserId: 'user-991199',
                    acceptedGameTick: 900n,
                    acceptedClockRevision: 31n,
                    acceptedDeadlineGeneration: 7n,
                    payload: {
                        type: 'messageRespond',
                        requestId: messageRequestId,
                        userId: 'user-991199',
                        generalId: 991_199,
                        messageId: message.id,
                        response: true,
                    },
                },
                {
                    requestId: scoutRequestId,
                    target: 'ENGINE',
                    eventType: 'messageRespond',
                    actorUserId: 'user-991199',
                    acceptedGameTick: 900n,
                    acceptedClockRevision: 31n,
                    acceptedDeadlineGeneration: 7n,
                    payload: {
                        type: 'messageRespond',
                        requestId: scoutRequestId,
                        userId: 'user-991199',
                        generalId: 991_199,
                        messageId: scoutMessage.id,
                        response: true,
                    },
                },
                {
                    requestId: gameplayRequestId,
                    target: 'ENGINE',
                    eventType: 'vacation',
                    actorUserId: 'user-991199',
                    acceptedGameTick: 900n,
                    acceptedClockRevision: 31n,
                    acceptedDeadlineGeneration: 7n,
                    payload: {
                        type: 'vacation',
                        requestId: gameplayRequestId,
                        userId: 'user-991199',
                        generalId: 991_199,
                    },
                },
            ],
        });

        const queue = new DatabaseTurnDaemonCommandQueue(db);
        await expect(queue.drain()).resolves.toEqual([
            {
                type: 'messageRespond',
                requestId: messageRequestId,
                userId: 'user-991199',
                generalId: 991_199,
                messageId: message.id,
                response: true,
                processingGameTick: 900,
                requestedAtWall: expect.any(Date),
            },
        ]);
        await expect(
            db.inputEvent.findUniqueOrThrow({ where: { requestId: gameplayRequestId } })
        ).resolves.toMatchObject({ status: 'PENDING' });
        await expect(db.inputEvent.findUniqueOrThrow({ where: { requestId: scoutRequestId } })).resolves.toMatchObject({
            status: 'PENDING',
        });
    });
});
