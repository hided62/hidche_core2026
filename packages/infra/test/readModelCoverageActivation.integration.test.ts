import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGamePostgresConnector, type GamePrismaClient } from '../src/gamePrisma.js';
import { activateReadModelRevisionCoverage } from '../src/readModelCoverageActivation.js';

const databaseUrl = process.env.READ_MODEL_JOURNAL_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration('read-model coverage activation PostgreSQL boundary', () => {
    let disconnect: (() => Promise<void>) | undefined;
    let prisma: GamePrismaClient;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        prisma = connector.prisma;
        disconnect = connector.disconnect;
        await connector.connect();
    });

    afterAll(async () => disconnect?.());

    beforeEach(async () => {
        await prisma.$transaction(async (transaction) => {
            await transaction.readModelRevision.deleteMany();
            await transaction.readModelRevisionMeta.upsert({
                where: { id: 1 },
                create: { id: 1, coverageVersion: 0 },
                update: { coverageVersion: 0 },
            });
        });
    });

    it('seeds shared heads and raises coverage in one idempotent transaction', async () => {
        await prisma.readModelRevision.create({
            data: { domain: 'dashboard.global', entityId: 0, revision: 9n },
        });

        await expect(
            prisma.$transaction((transaction) => activateReadModelRevisionCoverage(transaction))
        ).resolves.toEqual({ previousVersion: 0, coverageVersion: 1, seededHeads: 1 });
        await expect(
            prisma.$transaction((transaction) => activateReadModelRevisionCoverage(transaction))
        ).resolves.toEqual({ previousVersion: 1, coverageVersion: 1, seededHeads: 0 });

        await expect(prisma.readModelRevisionMeta.findUniqueOrThrow({ where: { id: 1 } })).resolves.toMatchObject({
            coverageVersion: 1,
        });
        await expect(
            prisma.readModelRevision.findUniqueOrThrow({
                where: { domain_entityId: { domain: 'dashboard.global', entityId: 0 } },
            })
        ).resolves.toMatchObject({ revision: 9n });
        await expect(
            prisma.readModelRevision.findUniqueOrThrow({
                where: { domain_entityId: { domain: 'map.world', entityId: 0 } },
            })
        ).resolves.toMatchObject({ revision: 1n });
    });

    it('rolls seeded heads and coverage back with the owner transaction', async () => {
        await expect(
            prisma.$transaction(async (transaction) => {
                await activateReadModelRevisionCoverage(transaction);
                throw new Error('rollback activation fixture');
            })
        ).rejects.toThrow('rollback activation fixture');

        await expect(prisma.readModelRevision.count()).resolves.toBe(0);
        await expect(prisma.readModelRevisionMeta.findUniqueOrThrow({ where: { id: 1 } })).resolves.toMatchObject({
            coverageVersion: 0,
        });
    });
});
