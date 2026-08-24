import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGamePostgresConnector, type GamePrismaClient } from '../src/gamePrisma.js';
import { writeReadModelChangeJournal } from '../src/readModelChangeJournal.js';
import {
    claimReadModelOutboxBatch,
    dispatchReadModelOutboxBatch,
    pruneDeliveredReadModelOutbox,
} from '../src/readModelOutboxDispatcher.js';
import { enqueueWebPushOutboxEvents } from '../src/webPushOutbox.js';

const databaseUrl = process.env.READ_MODEL_JOURNAL_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration('read-model outbox PostgreSQL delivery boundary', () => {
    let disconnect: (() => Promise<void>) | undefined;
    let prisma: GamePrismaClient;

    beforeAll(async () => {
        if (!databaseUrl) throw new Error('READ_MODEL_JOURNAL_DATABASE_URL is required.');
        const connector = createGamePostgresConnector({ url: databaseUrl });
        prisma = connector.prisma;
        disconnect = connector.disconnect;
        await connector.connect();
    });

    afterAll(async () => disconnect?.());

    beforeEach(async () => {
        await prisma.$executeRaw`
            TRUNCATE TABLE "read_model_outbox", "read_model_revision", "web_push_outbox" RESTART IDENTITY
        `;
    });

    const enqueue = async (entityId: number): Promise<void> => {
        await prisma.$transaction((transaction) =>
            writeReadModelChangeJournal(transaction, [{ domain: 'general.content', entityId }])
        );
    };

    it('claims concurrent worker batches without overlap', async () => {
        await Promise.all(Array.from({ length: 20 }, (_, index) => enqueue(index + 1)));
        const now = new Date('2099-08-16T00:00:00.000Z');
        const [left, right] = await Promise.all([
            claimReadModelOutboxBatch(prisma, { owner: 'left', limit: 10, now }),
            claimReadModelOutboxBatch(prisma, { owner: 'right', limit: 10, now }),
        ]);
        const ids = [...left, ...right].map(({ id }) => id);
        expect(ids).toHaveLength(20);
        expect(new Set(ids).size).toBe(20);
    });

    it('keeps both game outbox defaults claimable as current instants in a non-UTC session', async () => {
        const beforeInsert = Date.now();
        await prisma.$transaction(async (transaction) => {
            await transaction.$executeRaw`SET LOCAL TIME ZONE 'Asia/Seoul'`;
            await writeReadModelChangeJournal(transaction, [{ domain: 'general.content', entityId: 77 }]);
            await enqueueWebPushOutboxEvents(transaction, [
                {
                    eventId: 'non-utc-default-instant',
                    eventType: 'PRIVATE_MESSAGE_RECEIVED',
                    userIds: ['outbox-timezone-user'],
                },
            ]);
        });
        const afterInsert = Date.now();

        const readModelRow = await prisma.readModelOutbox.findFirstOrThrow();
        const webPushRow = await prisma.webPushOutbox.findFirstOrThrow();
        for (const [label, instant] of Object.entries({
            readModelAvailableAt: readModelRow.availableAt,
            readModelCreatedAt: readModelRow.createdAt,
            webPushAvailableAt: webPushRow.availableAt,
            webPushCreatedAt: webPushRow.createdAt,
        })) {
            expect(instant.getTime(), label).toBeGreaterThanOrEqual(beforeInsert - 1_000);
            expect(instant.getTime(), label).toBeLessThanOrEqual(afterInsert + 1_000);
        }
        const [storedDefaults] = await prisma.$queryRaw<
            Array<{
                readAvailableMs: number;
                readCreatedMs: number;
                webAvailableMs: number;
                webCreatedMs: number;
            }>
        >`
            SELECT
                (SELECT (EXTRACT(EPOCH FROM "available_at") * 1000)::double precision
                 FROM "read_model_outbox" LIMIT 1) AS "readAvailableMs",
                (SELECT (EXTRACT(EPOCH FROM "created_at") * 1000)::double precision
                 FROM "read_model_outbox" LIMIT 1) AS "readCreatedMs",
                (SELECT (EXTRACT(EPOCH FROM "available_at") * 1000)::double precision
                 FROM "web_push_outbox" LIMIT 1) AS "webAvailableMs",
                (SELECT (EXTRACT(EPOCH FROM "created_at") * 1000)::double precision
                 FROM "web_push_outbox" LIMIT 1) AS "webCreatedMs"
        `;
        if (!storedDefaults) throw new Error('outbox UTC-wall defaults were not persisted');
        for (const [label, instantMs] of Object.entries(storedDefaults)) {
            expect(instantMs, label).toBeGreaterThanOrEqual(beforeInsert - 1_000);
            expect(instantMs, label).toBeLessThanOrEqual(afterInsert + 1_000);
        }

        const lockAt = new Date();
        const retryAt = new Date(lockAt.getTime() + 60_000);
        await prisma.webPushOutbox.update({
            where: { eventId: 'non-utc-default-instant' },
            data: { availableAt: retryAt, lockedAt: lockAt, lockOwner: 'non-utc-session-worker' },
        });
        const [webPushSchedule] = await prisma.$queryRaw<
            Array<{
                availableMs: number;
                lockedMs: number;
                due: boolean;
                leaseExpired: boolean;
            }>
        >`
            SELECT
                (EXTRACT(EPOCH FROM "available_at") * 1000)::double precision AS "availableMs",
                (EXTRACT(EPOCH FROM "locked_at") * 1000)::double precision AS "lockedMs",
                "available_at" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS "due",
                "locked_at" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '30 seconds'
                    AS "leaseExpired"
            FROM "web_push_outbox"
            WHERE "event_id" = 'non-utc-default-instant'
        `;
        if (!webPushSchedule) throw new Error('web push UTC-wall schedule was not persisted');
        expect(webPushSchedule).toMatchObject({ due: false, leaseExpired: false });
        expect(Math.abs(webPushSchedule.availableMs - retryAt.getTime())).toBeLessThanOrEqual(1);
        expect(Math.abs(webPushSchedule.lockedMs - lockAt.getTime())).toBeLessThanOrEqual(1);

        await expect(
            claimReadModelOutboxBatch(prisma, {
                owner: 'non-utc-session-worker',
                limit: 1,
                now: new Date(afterInsert + 1_000),
            })
        ).resolves.toHaveLength(1);
    });

    it('releases a publish failure and later delivers the same row', async () => {
        await enqueue(7);
        const failedAt = new Date('2099-08-16T00:00:00.000Z');
        await expect(
            dispatchReadModelOutboxBatch(prisma, vi.fn().mockRejectedValue(new Error('redis unavailable')), {
                owner: 'worker-a',
                now: () => failedAt,
                retryBaseMs: 1_000,
            })
        ).resolves.toEqual({ claimed: 1, delivered: 0, failed: 1 });
        const released = await prisma.readModelOutbox.findUniqueOrThrow({ where: { id: 1n } });
        expect(released).toMatchObject({ attempts: 1, lockedAt: null, lockOwner: null, deliveredAt: null });
        expect(released.lastError).toContain('redis unavailable');

        const retryAt = new Date('2099-08-16T00:00:01.000Z');
        const publish = vi.fn().mockResolvedValue(undefined);
        await expect(
            dispatchReadModelOutboxBatch(prisma, publish, { owner: 'worker-b', now: () => retryAt })
        ).resolves.toEqual({ claimed: 1, delivered: 1, failed: 0 });
        expect(publish).toHaveBeenCalledTimes(1);
        await expect(prisma.readModelOutbox.findUniqueOrThrow({ where: { id: 1n } })).resolves.toMatchObject({
            attempts: 2,
            lockOwner: null,
            deliveredAt: retryAt,
        });
    });

    it('allows a lease-expired row to be republished after publish-before-ack crash', async () => {
        await enqueue(7);
        const first = await claimReadModelOutboxBatch(prisma, {
            owner: 'crashed-worker',
            leaseMs: 30_000,
            now: new Date('2099-08-16T00:00:00.000Z'),
        });
        expect(first).toHaveLength(1);

        const second = await claimReadModelOutboxBatch(prisma, {
            owner: 'recovery-worker',
            leaseMs: 30_000,
            now: new Date('2099-08-16T00:00:31.000Z'),
        });
        expect(second.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
        expect(second[0]?.attempts).toBe(2);
    });

    it('prunes delivered rows in bounded batches', async () => {
        await Promise.all([enqueue(1), enqueue(2), enqueue(3)]);
        const deliveredAt = new Date('2099-08-15T00:00:00.000Z');
        await prisma.readModelOutbox.updateMany({ data: { deliveredAt } });
        await expect(
            pruneDeliveredReadModelOutbox(prisma, {
                deliveredBefore: new Date('2099-08-16T00:00:00.000Z'),
                limit: 2,
            })
        ).resolves.toBe(2);
        await expect(prisma.readModelOutbox.count()).resolves.toBe(1);
    });
});
