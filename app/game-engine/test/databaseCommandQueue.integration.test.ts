import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
        await db.inputEvent.deleteMany({
            where: { requestId: { startsWith: 'integration:engine:' } },
        });
    });

    afterAll(async () => {
        await db.inputEvent.deleteMany({
            where: { requestId: { startsWith: 'integration:engine:' } },
        });
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

        expect(commands).toEqual([{ type: 'vacation', requestId, userId: 'user-7', generalId: 7 }]);
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

        expect(commands).toEqual([{ type: 'vacation', requestId: expiredId, userId: 'user-8', generalId: 8 }]);
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
                { type: 'vacation', requestId, userId: 'user-10', generalId: 10 },
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
        expect(claimed).toEqual([command]);
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
});
