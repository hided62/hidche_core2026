import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import type { DatabaseClient, GameApiContext } from '../src/context.js';
import {
    createApiInputPayloadIdentity,
    DuplicateInputEventError,
    executeInputEvent,
} from '../src/inputEventBoundary.js';
import { procedure, router } from '../src/trpc.js';
import {
    ConflictingTurnDaemonCommandError,
    DatabaseTurnDaemonTransport,
    FailedTurnDaemonCommandError,
} from '../src/daemon/databaseTransport.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const journalGeneralIds = [9_980_081, 9_980_082] as const;
const clockScenarioCode = 'input-event-boundary';

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
        await db.worldState.deleteMany({ where: { scenarioCode: clockScenarioCode } });
        const base = new Date('2099-09-03T00:00:00.000Z');
        await db.worldState.create({
            data: {
                scenarioCode: clockScenarioCode,
                currentYear: 200,
                currentMonth: 1,
                tickSeconds: 600,
                clockBaseTime: base,
                clockTick: 0n,
                clockMode: 'realtime',
                clockWallAnchor: base,
                clockPhase: 'RUNNING',
            },
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
        await db.worldState.deleteMany({ where: { scenarioCode: clockScenarioCode } });
        await close?.();
    });

    it('commits a direct DB mutation and its event marker together', async () => {
        const requestId = 'integration:api:success';
        const markerId = 'integration:api:success:marker';
        await executeInputEvent({
            db,
            requestId,
            eventType: 'test.success',
            payload: { markerId },
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
            payload: createApiInputPayloadIdentity({ markerId }),
            result: { ok: true },
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
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId: `${requestId}:mutate` } })).toMatchObject({
            payload: createApiInputPayloadIdentity({ generalId: journalGeneralIds[1], fail: true }),
            status: 'FAILED',
            result: null,
            attempts: 1,
        });
    });

    it('rolls back business writes, records failure, and permits one explicit retry', async () => {
        const requestId = 'integration:api:retry';
        const markerId = 'integration:api:retry:marker';
        await expect(
            executeInputEvent({
                db,
                requestId,
                eventType: 'test.failure',
                payload: { markerId },
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
            payload: createApiInputPayloadIdentity({ markerId }),
            result: null,
            attempts: 1,
            error: 'injected transaction failure',
        });

        await executeInputEvent({
            db,
            requestId,
            eventType: 'test.failure',
            payload: { markerId },
            execute: async () => ({ ok: true }),
        });
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).toMatchObject({
            status: 'SUCCEEDED',
            result: { ok: true },
            attempts: 2,
        });
    });

    it('serializes an exact concurrent retry and replays the original result without re-executing business', async () => {
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
            payload: { value: 7 },
            execute: async () => {
                signalStarted?.();
                await release;
                return { ok: true, revision: 17 };
            },
        });
        await started;

        const duplicateExecute = vi.fn(async () => ({ ok: true, revision: 99 }));
        const duplicate = executeInputEvent({
            db,
            requestId,
            eventType: 'test.duplicate',
            payload: { value: 7 },
            execute: duplicateExecute,
        });
        releaseFirst?.();
        await expect(Promise.all([first, duplicate])).resolves.toEqual([
            { ok: true, revision: 17 },
            { ok: true, revision: 17 },
        ]);
        expect(duplicateExecute).not.toHaveBeenCalled();
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).toMatchObject({
            payload: createApiInputPayloadIdentity({ value: 7 }),
            result: { ok: true, revision: 17 },
            status: 'SUCCEEDED',
            attempts: 1,
        });
    });

    it('rejects request-id reuse with a changed payload, event type, or actor', async () => {
        const requestId = 'integration:api:identity-conflict';
        const original = await executeInputEvent({
            db,
            requestId,
            eventType: 'test.identity',
            payload: { value: 1, nested: { left: true, right: false } },
            actorUserId: 'user-identity',
            execute: async () => ({ ok: true, revision: 4 }),
        });
        expect(original).toEqual({ ok: true, revision: 4 });

        const conflicts = [
            {
                eventType: 'test.identity',
                payload: { value: 2, nested: { left: true, right: false } },
                actorUserId: 'user-identity',
            },
            {
                eventType: 'test.other-identity',
                payload: { value: 1, nested: { left: true, right: false } },
                actorUserId: 'user-identity',
            },
            {
                eventType: 'test.identity',
                payload: { value: 1, nested: { left: true, right: false } },
                actorUserId: 'other-user',
            },
        ];
        for (const conflict of conflicts) {
            const conflictingExecute = vi.fn(async () => ({ ok: false }));
            await expect(
                executeInputEvent({ db, requestId, ...conflict, execute: conflictingExecute })
            ).rejects.toBeInstanceOf(DuplicateInputEventError);
            expect(conflictingExecute).not.toHaveBeenCalled();
        }

        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).toMatchObject({
            eventType: 'test.identity',
            actorUserId: 'user-identity',
            payload: createApiInputPayloadIdentity({ value: 1, nested: { left: true, right: false } }),
            result: { ok: true, revision: 4 },
            status: 'SUCCEEDED',
            attempts: 1,
        });
    });

    it('reclaims an exact PENDING row under lock and counts one execution attempt', async () => {
        const requestId = 'integration:api:pending-reclaim';
        const payload = { value: 'pending' };
        await db.inputEvent.create({
            data: {
                requestId,
                target: 'API',
                eventType: 'test.pending',
                payload: { ...createApiInputPayloadIdentity(payload) },
                actorUserId: 'pending-user',
                status: 'PENDING',
                attempts: 3,
            },
        });

        await expect(
            executeInputEvent({
                db,
                requestId,
                eventType: 'test.pending',
                payload,
                actorUserId: 'pending-user',
                execute: async () => ({ ok: true, attempt: 4 }),
            })
        ).resolves.toEqual({ ok: true, attempt: 4 });
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).toMatchObject({
            status: 'SUCCEEDED',
            result: { ok: true, attempt: 4 },
            attempts: 4,
        });
    });

    it('adopts only a matching legacy FAILED placeholder and replaces it with the canonical digest', async () => {
        const requestId = 'integration:api:legacy-failed';
        const payload = { value: 'legacy-retry' };
        await db.inputEvent.create({
            data: {
                requestId,
                target: 'API',
                eventType: 'test.legacy-failed',
                payload: {},
                actorUserId: 'legacy-user',
                status: 'FAILED',
                attempts: 2,
                error: 'legacy failure',
                completedAt: new Date(),
            },
        });

        await expect(
            executeInputEvent({
                db,
                requestId,
                eventType: 'test.legacy-failed',
                payload,
                actorUserId: 'legacy-user',
                execute: async () => ({ ok: true }),
            })
        ).resolves.toEqual({ ok: true });
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).toMatchObject({
            payload: createApiInputPayloadIdentity(payload),
            status: 'SUCCEEDED',
            result: { ok: true },
            error: null,
            attempts: 3,
        });
    });

    it('fails closed on a committed legacy PROCESSING placeholder', async () => {
        const requestId = 'integration:api:legacy-processing';
        const processingAt = new Date(Date.now() - 60 * 60 * 1_000);
        await db.inputEvent.create({
            data: {
                requestId,
                target: 'API',
                eventType: 'test.legacy-processing',
                payload: {},
                actorUserId: 'legacy-user',
                status: 'PROCESSING',
                attempts: 1,
                processingAt,
            },
        });
        const retryExecute = vi.fn(async () => ({ ok: true }));

        await expect(
            executeInputEvent({
                db,
                requestId,
                eventType: 'test.legacy-processing',
                payload: { value: 'cannot-prove-legacy-identity' },
                actorUserId: 'legacy-user',
                execute: retryExecute,
            })
        ).rejects.toBeInstanceOf(DuplicateInputEventError);
        expect(retryExecute).not.toHaveBeenCalled();
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).toMatchObject({
            payload: {},
            status: 'PROCESSING',
            attempts: 1,
            processingAt,
        });
    });

    it('commits FAILED before a blocked exact retry and preserves the exact attempt count after success', async () => {
        const requestId = 'integration:api:failure-race';
        const payload = { value: 'race' };
        let releaseFailure: (() => void) | undefined;
        let signalStarted: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
            signalStarted = resolve;
        });
        const release = new Promise<void>((resolve) => {
            releaseFailure = resolve;
        });
        const failed = executeInputEvent({
            db,
            requestId,
            eventType: 'test.failure-race',
            payload,
            execute: async () => {
                signalStarted?.();
                await release;
                throw new Error('first attempt failed');
            },
        });
        await started;
        const retry = executeInputEvent({
            db,
            requestId,
            eventType: 'test.failure-race',
            payload,
            execute: async () => ({ ok: true, attempt: 2 }),
        });

        releaseFailure?.();
        await expect(failed).rejects.toThrow('first attempt failed');
        await expect(retry).resolves.toEqual({ ok: true, attempt: 2 });
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).toMatchObject({
            status: 'SUCCEEDED',
            result: { ok: true, attempt: 2 },
            error: null,
            attempts: 2,
        });
    });

    it('does not let a late unexpected-failure recorder overwrite a transaction that actually committed', async () => {
        const requestId = 'integration:api:ambiguous-commit';
        const payload = { value: 'committed-before-client-error' };
        const ambiguousCommitDb = new Proxy(db, {
            get(target, property, receiver) {
                if (property !== '$transaction') return Reflect.get(target, property, receiver);
                return async (callback: (transaction: DatabaseClient) => Promise<unknown>) => {
                    await db.$transaction(async (transaction) => callback(transaction));
                    throw new Error('injected post-commit transport failure');
                };
            },
        }) as unknown as DatabaseClient;

        await expect(
            executeInputEvent({
                db: ambiguousCommitDb,
                requestId,
                eventType: 'test.ambiguous-commit',
                payload,
                execute: async () => ({ ok: true, revision: 8 }),
            })
        ).rejects.toThrow('injected post-commit transport failure');
        expect(await db.inputEvent.findUniqueOrThrow({ where: { requestId } })).toMatchObject({
            status: 'SUCCEEDED',
            result: { ok: true, revision: 8 },
            error: null,
            attempts: 1,
        });

        const replayExecute = vi.fn(async () => ({ ok: false }));
        await expect(
            executeInputEvent({
                db,
                requestId,
                eventType: 'test.ambiguous-commit',
                payload,
                execute: replayExecute,
            })
        ).resolves.toEqual({ ok: true, revision: 8 });
        expect(replayExecute).not.toHaveBeenCalled();
    });

    it('reuses the same engine child event but rejects a changed retry payload', async () => {
        const transport = new DatabaseTurnDaemonTransport(db, 100);
        const requestId = 'integration:api:engine-child';
        const worldClock = await db.worldState.findFirst({
            orderBy: { id: 'asc' },
            select: { clockRevision: true, deadlineGeneration: true },
        });
        const acceptedWindowStart = Date.now();
        await transport.sendCommand({ type: 'vacation', requestId, userId: 'user-7', generalId: 7 });
        const acceptedWindowEnd = Date.now();
        const event = await db.inputEvent.findUniqueOrThrow({ where: { requestId } });
        expect(event.actorUserId).toBe('user-7');
        expect(event.createdAt.getTime()).toBeGreaterThanOrEqual(acceptedWindowStart);
        expect(event.createdAt.getTime()).toBeLessThanOrEqual(acceptedWindowEnd);
        expect(event.acceptedGameTick).not.toBeNull();
        expect(event.acceptedClockRevision).toBe(worldClock?.clockRevision ?? null);
        expect(event.acceptedDeadlineGeneration).toBe(worldClock?.deadlineGeneration ?? null);
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
