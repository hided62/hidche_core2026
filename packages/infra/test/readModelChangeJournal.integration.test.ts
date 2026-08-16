import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ChangeJournal } from '@sammo-ts/common';

import { createGamePostgresConnector, type GamePrismaClient } from '../src/gamePrisma.js';
import { writeReadModelChangeJournal } from '../src/readModelChangeJournal.js';

const databaseUrl = process.env.READ_MODEL_JOURNAL_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration('read-model change journal PostgreSQL boundary', () => {
    let disconnect: (() => Promise<void>) | undefined;
    let prisma: GamePrismaClient;

    beforeAll(async () => {
        if (!databaseUrl) {
            throw new Error('READ_MODEL_JOURNAL_DATABASE_URL is required.');
        }
        const connector = createGamePostgresConnector({ url: databaseUrl });
        prisma = connector.prisma;
        disconnect = connector.disconnect;
        await connector.connect();
    });

    afterAll(async () => {
        await disconnect?.();
    });

    beforeEach(async () => {
        await prisma.$executeRaw`TRUNCATE TABLE "read_model_outbox", "read_model_revision" RESTART IDENTITY`;
    });

    it('commits normalized revisions and one compact outbox payload', async () => {
        const journal = new ChangeJournal().mark('map.world').mark('general.content', 7).mark('map.world');

        const receipt = await prisma.$transaction((transaction) =>
            writeReadModelChangeJournal(transaction, journal.snapshot())
        );
        const outboxes = await prisma.readModelOutbox.findMany();

        expect(receipt).toEqual({
            invalidation: {
                revisions: [
                    { domain: 'general.content', entityId: 7, revision: 1n },
                    { domain: 'map.world', entityId: 0, revision: 1n },
                ],
            },
            outboxId: 1n,
        });
        expect(outboxes).toHaveLength(1);
        expect(outboxes[0]?.payload).toEqual({
            version: 1,
            changes: [
                ['general.content', 7, '1'],
                ['map.world', 0, '1'],
            ],
        });
    });

    it('rolls revision and outbox changes back with the owner transaction', async () => {
        await expect(
            prisma.$transaction(async (transaction) => {
                await writeReadModelChangeJournal(transaction, [{ domain: 'nation.content', entityId: 2 }]);
                throw new Error('rollback fixture');
            })
        ).rejects.toThrow('rollback fixture');

        await expect(prisma.readModelRevision.count()).resolves.toBe(0);
        await expect(prisma.readModelOutbox.count()).resolves.toBe(0);
    });

    it('does not lose increments from concurrent writers of the same key', async () => {
        const writerCount = 32;
        await Promise.all(
            Array.from({ length: writerCount }, () =>
                prisma.$transaction((transaction) =>
                    writeReadModelChangeJournal(transaction, [{ domain: 'world.content', entityId: 0 }])
                )
            )
        );

        const revision = await prisma.readModelRevision.findUniqueOrThrow({
            where: { domain_entityId: { domain: 'world.content', entityId: 0 } },
        });
        expect(revision.revision).toBe(BigInt(writerCount));
        await expect(prisma.readModelOutbox.count()).resolves.toBe(writerCount);
    });

    it('keeps revision-first coverage disabled by default', async () => {
        const meta = await prisma.readModelRevisionMeta.findUniqueOrThrow({ where: { id: 1 } });
        expect(meta.coverageVersion).toBe(0);
    });

    it('uses the Prisma-declared outbox dispatch index name', async () => {
        const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
            SELECT "indexname"
            FROM "pg_indexes"
            WHERE "schemaname" = current_schema()
              AND "tablename" = 'read_model_outbox'
        `;
        expect(indexes.map(({ indexname }) => indexname)).toContain(
            'read_model_outbox_delivered_at_available_at_id_idx'
        );
    });

    it('rejects negative revision, entity, retry, and coverage state at the database boundary', async () => {
        await expect(
            prisma.readModelRevision.create({
                data: { domain: 'general.content', entityId: -1 },
            })
        ).rejects.toThrow();
        await expect(
            prisma.readModelRevision.create({
                data: { domain: 'general.content', entityId: 1, revision: -1 },
            })
        ).rejects.toThrow();
        await expect(
            prisma.readModelOutbox.create({
                data: { payload: {}, attempts: -1 },
            })
        ).rejects.toThrow();
        await expect(
            prisma.readModelRevisionMeta.update({
                where: { id: 1 },
                data: { coverageVersion: -1 },
            })
        ).rejects.toThrow();
    });
});
