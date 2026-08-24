import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import type { GameApiContext } from '../src/context.js';
import { DuplicateInputEventError, executeInputEvent } from '../src/inputEventBoundary.js';
import { procedure, router } from '../src/trpc.js';
import {
    ConflictingTurnDaemonCommandError,
    DatabaseTurnDaemonTransport,
    FailedTurnDaemonCommandError,
} from '../src/daemon/databaseTransport.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const journalGeneralIds = [9_980_081, 9_980_082] as const;

const journalBoundaryRouter = router({
    mutate: procedure
        .input(z.object({ generalId: z.number().int(), fail: z.boolean().optional().default(false) }))
        .mutation(({ ctx, input }) => {
            ctx.changeJournal?.mark('front.general', input.generalId);
            if (input.fail) {
                throw new Error('injected journal rollback');
            }
            return { ok: true };
        }),
});

const payloadHasGeneral = (payload: unknown, generalId: number): boolean => {
    if (!payload || typeof payload !== 'object' || !('changes' in payload)) return false;
    const changes = (payload as { changes?: unknown }).changes;
    return (
        Array.isArray(changes) &&
        changes.some((change) => Array.isArray(change) && change[0] === 'front.general' && change[1] === generalId)
    );
};

integration('API input event boundary', () => {
    let close: (() => Promise<void>) | undefined;
    let db: GamePrismaClient;
    const createdOutboxIds: bigint[] = [];

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
        await db.inputEvent.deleteMany({
            where: { requestId: { startsWith: 'integration:api:' } },
        });
        await db.readModelRevision.deleteMany({
            where: { domain: 'front.general', entityId: { in: [...journalGeneralIds] } },
        });
    });

    afterAll(async () => {
        await db.inputEvent.deleteMany({
            where: { requestId: { startsWith: 'integration:api:' } },
        });
        if (createdOutboxIds.length > 0) {
            await db.readModelOutbox.deleteMany({ where: { id: { in: createdOutboxIds } } });
        }
        await db.readModelRevision.deleteMany({
            where: { domain: 'front.general', entityId: { in: [...journalGeneralIds] } },
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
        expect(event.processingAt).toBeInstanceOf(Date);
        expect(Math.abs(event.createdAt.getTime() - (event.processingAt?.getTime() ?? 0))).toBeLessThan(1_000);
        expect(marker.status).toBe('PENDING');
    });

    it('persists an API journal with SUCCEEDED and only wakes delivery after commit', async () => {
        const requestId = 'integration:api:journal-success';
        const redisPublish = vi.fn();
        let wakeSnapshot: Promise<unknown> | undefined;
        const context = {
            db,
            requestId,
            redis: { publish: redisPublish },
            readModelOutbox: {
                wake: () => {
                    wakeSnapshot = Promise.all([
                        db.inputEvent.findUniqueOrThrow({ where: { requestId: `${requestId}:mutate` } }),
                        db.readModelRevision.findUniqueOrThrow({
                            where: {
                                domain_entityId: {
                                    domain: 'front.general',
                                    entityId: journalGeneralIds[0],
                                },
                            },
                        }),
                    ]);
                },
            },
        } as unknown as GameApiContext;

        await expect(
            journalBoundaryRouter.createCaller(context).mutate({ generalId: journalGeneralIds[0] })
        ).resolves.toEqual({ ok: true });

        expect(wakeSnapshot).toBeDefined();
        const [event, revision] = (await wakeSnapshot) as [{ status: string }, { revision: bigint }];
        expect(event.status).toBe('SUCCEEDED');
        expect(revision.revision).toBe(1n);
        expect(redisPublish).not.toHaveBeenCalled();

        const outboxes = await db.readModelOutbox.findMany({ select: { id: true, payload: true } });
        const outbox = outboxes.find(({ payload }) => payloadHasGeneral(payload, journalGeneralIds[0]));
        expect(outbox).toBeDefined();
        if (outbox) createdOutboxIds.push(outbox.id);
    });

    it('rolls back an API journal and never schedules delivery when the handler fails', async () => {
        const requestId = 'integration:api:journal-rollback';
        const wake = vi.fn();
        const context = {
            db,
            requestId,
            readModelOutbox: { wake },
        } as unknown as GameApiContext;

        await expect(
            journalBoundaryRouter.createCaller(context).mutate({ generalId: journalGeneralIds[1], fail: true })
        ).rejects.toThrow('injected journal rollback');

        await expect(
            db.readModelRevision.findUnique({
                where: {
                    domain_entityId: {
                        domain: 'front.general',
                        entityId: journalGeneralIds[1],
                    },
                },
            })
        ).resolves.toBeNull();
        const outboxes = await db.readModelOutbox.findMany({ select: { payload: true } });
        expect(outboxes.some(({ payload }) => payloadHasGeneral(payload, journalGeneralIds[1]))).toBe(false);
        expect(wake).not.toHaveBeenCalled();
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
        const acceptedWindowStart = Date.now();
        await transport.sendCommand({ type: 'vacation', requestId, userId: 'user-7', generalId: 7 });
        const acceptedWindowEnd = Date.now();
        const event = await db.inputEvent.findUniqueOrThrow({ where: { requestId } });
        expect(event.actorUserId).toBe('user-7');
        expect(event.createdAt.getTime()).toBeGreaterThanOrEqual(acceptedWindowStart);
        expect(event.createdAt.getTime()).toBeLessThanOrEqual(acceptedWindowEnd);
        await expect(
            transport.sendCommand({ type: 'vacation', requestId, userId: 'user-7', generalId: 7 })
        ).resolves.toBe(requestId);
        await expect(
            transport.sendCommand({ type: 'vacation', requestId, userId: 'user-7', generalId: 8 })
        ).rejects.toBeInstanceOf(ConflictingTurnDaemonCommandError);
    });

    it('distinguishes a stored terminal engine failure from a result timeout', async () => {
        const transport = new DatabaseTurnDaemonTransport(db, 100);
        const requestId = 'integration:api:engine-failed';
        const command = { type: 'vacation' as const, requestId, userId: 'user-7', generalId: 7 };
        await transport.sendCommand(command);
        await db.inputEvent.update({
            where: { requestId },
            data: {
                status: 'FAILED',
                error: 'injected terminal engine failure',
                completedAt: new Date(),
            },
        });

        await expect(transport.requestCommand(command)).rejects.toMatchObject({
            name: FailedTurnDaemonCommandError.name,
            requestId,
            storedError: 'injected terminal engine failure',
        });
    });
});
