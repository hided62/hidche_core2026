import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';

import { DatabaseTurnDaemonCommandQueue } from '../src/lifecycle/databaseCommandQueue.js';

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
                payload: { type: 'vacation', requestId, generalId: 7 } as GamePrisma.InputJsonValue,
            },
        });

        const first = new DatabaseTurnDaemonCommandQueue(db);
        const second = new DatabaseTurnDaemonCommandQueue(db);
        const [firstCommands, secondCommands] = await Promise.all([first.drain(), second.drain()]);
        const commands = firstCommands.concat(secondCommands);

        expect(commands).toEqual([{ type: 'vacation', requestId, generalId: 7 }]);
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
                    payload: { type: 'vacation', requestId: expiredId, generalId: 8 } as GamePrisma.InputJsonValue,
                    status: 'PROCESSING',
                    processingAt: new Date(Date.now() - 120_000),
                    lockedBy: 'dead-worker',
                    leaseUntil: new Date(Date.now() - 60_000),
                },
                {
                    requestId: activeId,
                    target: 'ENGINE',
                    eventType: 'vacation',
                    payload: { type: 'vacation', requestId: activeId, generalId: 9 } as GamePrisma.InputJsonValue,
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

        expect(commands).toEqual([{ type: 'vacation', requestId: expiredId, generalId: 8 }]);
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId: activeId } })).toMatchObject({
            status: 'PROCESSING',
            lockedBy: 'active-worker',
        });
    });
});
