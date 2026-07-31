import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGatewayPostgresConnector, type GatewayPrismaClient } from '@sammo-ts/infra';

import { createPostgresUserRepository } from '../src/auth/postgresUserRepository.js';

const databaseUrl = process.env.GATEWAY_RUNTIME_ACTION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const userId = 'e72680fd-0aed-4fdd-80d9-24f78d55676c';

const assertDedicatedSchema = (): void => {
    const expected = process.env.GATEWAY_RUNTIME_INTEGRATION_SCHEMA;
    const actual = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') : null;
    if (!expected || !expected.endsWith('_gateway_runtime_integration') || actual !== expected) {
        throw new Error('Refusing to mutate a Gateway database outside the runner-owned integration schema.');
    }
};

integration('account icon daily PostgreSQL CAS', () => {
    let db: GatewayPrismaClient;
    let closeDb: (() => Promise<void>) | undefined;
    let initialized = false;

    beforeAll(async () => {
        assertDedicatedSchema();
        const connector = createGatewayPostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        initialized = true;
        closeDb = () => connector.disconnect();
        await db.appUser.deleteMany({ where: { id: userId } });
        await db.appUser.create({
            data: {
                id: userId,
                loginId: 'icon-cas-integration',
                displayName: '아이콘 CAS 통합',
                passwordHash: 'not-used',
                passwordSalt: 'not-used',
                roles: ['user'],
                sanctions: {},
                picture: 'old.png',
                imageServer: 1,
                iconUpdatedAt: new Date('2026-07-30T09:00:00.000Z'),
            },
        });
    });

    afterAll(async () => {
        if (initialized) {
            await db.appUser.deleteMany({ where: { id: userId } });
        }
        await closeDb?.();
    });

    it('allows exactly one concurrent update in the same KST day', async () => {
        const users = createPostgresUserRepository(db);
        const updatedAt = new Date('2026-07-31T15:00:00.000Z');
        const kstDayStart = new Date('2026-07-31T15:00:00.000Z');
        const results = await Promise.all([
            users.updateIconForDay(userId, 'first.png', 1, updatedAt, kstDayStart, true),
            users.updateIconForDay(userId, 'second.png', 1, updatedAt, kstDayStart, true),
        ]);

        expect(results.filter(Boolean)).toHaveLength(1);
        await expect(db.appUser.findUniqueOrThrow({ where: { id: userId } })).resolves.toMatchObject({
            picture: expect.stringMatching(/^(first|second)\.png$/),
            imageServer: 1,
            iconUpdatedAt: updatedAt,
        });
    });

    it('allows a default icon to upload again while revisions stay strictly increasing', async () => {
        const users = createPostgresUserRepository(db);
        const frozenNow = new Date('2026-08-01T03:00:00.000Z');
        const kstDayStart = new Date('2026-07-31T15:00:00.000Z');
        await db.appUser.update({
            where: { id: userId },
            data: {
                picture: 'old.png',
                imageServer: 1,
                iconUpdatedAt: new Date('2026-07-30T14:59:59.000Z'),
                iconRevision: new Date('2026-08-01T03:00:00.000Z'),
            },
        });

        const deletedRevision = await users.updateIconForDay(userId, 'default.jpg', 0, frozenNow, kstDayStart, false);
        const uploadedRevision = await users.updateIconForDay(userId, 'again.png', 1, frozenNow, kstDayStart, true);

        expect(deletedRevision).toBe('2026-08-01T03:00:00.001Z');
        expect(uploadedRevision).toBe('2026-08-01T03:00:00.002Z');
        await expect(db.appUser.findUniqueOrThrow({ where: { id: userId } })).resolves.toMatchObject({
            picture: 'again.png',
            iconUpdatedAt: frozenNow,
            iconRevision: new Date('2026-08-01T03:00:00.002Z'),
        });
    });

    it('uses UTC 15:00 as the KST date boundary', async () => {
        const users = createPostgresUserRepository(db);
        await db.appUser.update({
            where: { id: userId },
            data: {
                picture: 'same-day.png',
                imageServer: 1,
                iconUpdatedAt: new Date('2026-07-31T14:59:59.000Z'),
                iconRevision: new Date('2026-07-31T14:59:59.000Z'),
            },
        });

        await expect(
            users.updateIconForDay(
                userId,
                'blocked.png',
                1,
                new Date('2026-07-31T14:59:59.999Z'),
                new Date('2026-07-30T15:00:00.000Z'),
                true
            )
        ).resolves.toBeNull();
        await expect(
            users.updateIconForDay(
                userId,
                'allowed.png',
                1,
                new Date('2026-07-31T15:00:00.000Z'),
                new Date('2026-07-31T15:00:00.000Z'),
                true
            )
        ).resolves.toBeTruthy();
    });

    it('serializes administrator reset revisions in a dedicated column', async () => {
        const users = createPostgresUserRepository(db);
        const frozenNow = new Date('2026-08-02T00:00:00.000Z');
        await db.appUser.update({
            where: { id: userId },
            data: {
                picture: 'custom.png',
                imageServer: 1,
                iconRevision: frozenNow,
                profileIconResetAt: null,
                sanctions: { warningCount: 1 },
            },
        });

        const first = await users.resetProfileIcon(userId, frozenNow);
        const second = await users.resetProfileIcon(userId, frozenNow);

        expect(first).toBe('2026-08-02T00:00:00.001Z');
        expect(second).toBe('2026-08-02T00:00:00.002Z');
        await expect(db.appUser.findUniqueOrThrow({ where: { id: userId } })).resolves.toMatchObject({
            profileIconResetAt: new Date('2026-08-02T00:00:00.002Z'),
            iconRevision: new Date('2026-08-02T00:00:00.002Z'),
            sanctions: { warningCount: 1 },
        });
    });
});
