import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { DuplicateInputEventError, executeInputEvent } from '../src/inputEventBoundary.js';
import { ConflictingTurnDaemonCommandError, DatabaseTurnDaemonTransport } from '../src/daemon/databaseTransport.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration('API input event boundary', () => {
    let close: (() => Promise<void>) | undefined;
    let db: GamePrismaClient;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
        await db.inputEvent.deleteMany({
            where: { requestId: { startsWith: 'integration:api:' } },
        });
    });

    afterAll(async () => {
        await db.inputEvent.deleteMany({
            where: { requestId: { startsWith: 'integration:api:' } },
        });
        await close?.();
    });

    it('commits a direct DB mutation and its event marker together', async () => {
        const requestId = 'integration:api:success';
        const markerId = 'integration:api:success:marker';
        await executeInputEvent({
            db,
            requestId,
            eventType: 'test.success',
            actorUserId: 'user-7',
            execute: async (transaction) => {
                await transaction.inputEvent.create({
                    data: {
                        requestId: markerId,
                        target: 'API',
                        eventType: 'test.marker',
                    },
                });
                return { ok: true };
            },
        });

        const [event, marker] = await Promise.all([
            db.inputEvent.findUniqueOrThrow({ where: { requestId } }),
            db.inputEvent.findUniqueOrThrow({ where: { requestId: markerId } }),
        ]);
        expect(event).toMatchObject({
            status: 'SUCCEEDED',
            actorUserId: 'user-7',
            attempts: 1,
        });
        expect(marker.status).toBe('PENDING');
    });

    it('rolls back business writes, records failure, and permits one explicit retry', async () => {
        const requestId = 'integration:api:retry';
        const markerId = 'integration:api:retry:marker';
        await expect(
            executeInputEvent({
                db,
                requestId,
                eventType: 'test.failure',
                execute: async (transaction) => {
                    await transaction.inputEvent.create({
                        data: {
                            requestId: markerId,
                            target: 'API',
                            eventType: 'test.marker',
                        },
                    });
                    throw new Error('injected transaction failure');
                },
            })
        ).rejects.toThrow('injected transaction failure');

        expect(await db.inputEvent.findUnique({ where: { requestId: markerId } })).toBeNull();
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).toMatchObject({
            status: 'FAILED',
            attempts: 1,
            error: 'injected transaction failure',
        });

        await executeInputEvent({
            db,
            requestId,
            eventType: 'test.failure',
            execute: async () => ({ ok: true }),
        });
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).toMatchObject({
            status: 'SUCCEEDED',
            attempts: 2,
        });
    });

    it('rejects a concurrent duplicate idempotency key', async () => {
        const requestId = 'integration:api:duplicate';
        let releaseFirst: (() => void) | undefined;
        let signalStarted: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
            signalStarted = resolve;
        });
        const release = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const first = executeInputEvent({
            db,
            requestId,
            eventType: 'test.duplicate',
            execute: async () => {
                signalStarted?.();
                await release;
                return { ok: true };
            },
        });
        await started;

        await expect(
            executeInputEvent({
                db,
                requestId,
                eventType: 'test.duplicate',
                execute: async () => ({ ok: true }),
            })
        ).rejects.toBeInstanceOf(DuplicateInputEventError);

        releaseFirst?.();
        await first;
    });

    it('reuses the same engine child event but rejects a changed retry payload', async () => {
        const transport = new DatabaseTurnDaemonTransport(db, 100);
        const requestId = 'integration:api:engine-child';
        await transport.sendCommand({ type: 'vacation', requestId, generalId: 7 });
        await expect(transport.sendCommand({ type: 'vacation', requestId, generalId: 7 })).resolves.toBe(requestId);
        await expect(transport.sendCommand({ type: 'vacation', requestId, generalId: 8 })).rejects.toBeInstanceOf(
            ConflictingTurnDaemonCommandError
        );
    });
});
