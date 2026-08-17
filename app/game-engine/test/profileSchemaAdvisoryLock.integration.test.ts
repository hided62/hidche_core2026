import {
    acquireGameSchemaAdvisoryXactLock,
    createGamePostgresConnector,
    GamePrisma,
    tryGameSchemaAdvisoryXactLock,
} from '@sammo-ts/infra';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const primaryDatabaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const secondaryDatabaseUrl = process.env.PROFILE_LOCK_SECONDARY_DATABASE_URL;
const integration = describe.skipIf(!primaryDatabaseUrl || !secondaryDatabaseUrl);

integration('profile schema advisory lock and shared pool PostgreSQL boundary', () => {
    const primaryOne = createGamePostgresConnector({ url: primaryDatabaseUrl!, maxConnections: 2 });
    const primaryTwo = createGamePostgresConnector({ url: primaryDatabaseUrl!, maxConnections: 2 });
    const secondary = createGamePostgresConnector({ url: secondaryDatabaseUrl!, maxConnections: 1 });

    beforeAll(async () => {
        await Promise.all([primaryOne.connect(), primaryTwo.connect(), secondary.connect()]);
    });

    afterAll(async () => {
        await Promise.allSettled([primaryOne.disconnect(), primaryTwo.disconnect(), secondary.disconnect()]);
    });

    it('serializes the same logical key within a schema without blocking a sibling profile schema', async () => {
        const logicalKey = 'integration:same-logical-resource';
        let releaseHolder = (): void => undefined;
        const holderRelease = new Promise<void>((resolve) => {
            releaseHolder = resolve;
        });
        let markAcquired = (): void => undefined;
        const holderAcquired = new Promise<void>((resolve) => {
            markAcquired = resolve;
        });
        const holder = primaryOne.prisma.$transaction(async (transaction) => {
            await acquireGameSchemaAdvisoryXactLock(transaction, logicalKey);
            markAcquired();
            await holderRelease;
        });
        await holderAcquired;

        try {
            await expect(
                primaryTwo.prisma.$transaction((transaction) => tryGameSchemaAdvisoryXactLock(transaction, logicalKey))
            ).resolves.toBe(false);
            await expect(
                secondary.prisma.$transaction((transaction) => tryGameSchemaAdvisoryXactLock(transaction, logicalKey))
            ).resolves.toBe(true);

            const firstStats = primaryOne.getPoolStats();
            const secondStats = primaryTwo.getPoolStats();
            expect(firstStats).toEqual(secondStats);
            expect(firstStats).toMatchObject({ max: 2, total: 2, active: 1, idle: 1, waiting: 0 });
        } finally {
            releaseHolder();
            await holder;
        }

        await expect(
            primaryTwo.prisma.$transaction((transaction) => tryGameSchemaAdvisoryXactLock(transaction, logicalKey))
        ).resolves.toBe(true);
    });

    it('keeps the shared pool alive until its last connector disconnects', async () => {
        await primaryOne.disconnect();
        await expect(primaryTwo.prisma.$queryRaw(GamePrisma.sql`SELECT current_schema()`)).resolves.toHaveLength(1);
        expect(primaryTwo.getPoolStats()).toMatchObject({ max: 2 });
    });
});
