import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGatewayPostgresConnector, type GatewayPrismaClient } from '@sammo-ts/infra';

import { createPostgresUserRepository } from '../src/auth/postgresUserRepository.js';

const databaseUrl = process.env.GATEWAY_RUNTIME_ACTION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const userId = '14a4d550-e92c-4aec-81e1-e6235dc17ded';
const adminId = 'b6b327d8-e95e-4858-9b66-4fd22a286145';

const assertDedicatedSchema = (): void => {
    const expected = process.env.GATEWAY_RUNTIME_INTEGRATION_SCHEMA;
    const actual = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') : null;
    if (!expected || !expected.endsWith('_gateway_runtime_integration') || actual !== expected) {
        throw new Error('Refusing to mutate a Gateway database outside the runner-owned integration schema.');
    }
};

integration('special account access PostgreSQL boundary', () => {
    let db: GatewayPrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        assertDedicatedSchema();
        const connector = createGatewayPostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.appUser.deleteMany({ where: { id: userId } });
        await db.appUser.create({
            data: {
                id: userId,
                loginId: 'special-access-integration',
                displayName: '특수 접근 통합',
                passwordHash: 'not-used',
                passwordSalt: 'not-used',
                roles: ['user'],
                sanctions: {},
            },
        });
    });

    afterAll(async () => {
        await db?.appUser.deleteMany({ where: { id: userId } });
        await closeDb?.();
    });

    it('persists profile scope and preserves revocation provenance', async () => {
        const users = createPostgresUserRepository(db);
        const grant = await users.createSpecialAccessGrant(userId, {
            kind: 'RECOVERY',
            profiles: ['che'],
            allowsGeneralCreation: true,
            expiresAt: new Date('2026-09-01T00:00:00.000Z'),
            reason: '분실 단말 복구 기간',
            grantedByUserId: adminId,
        });

        await expect(users.listSpecialAccessGrants(userId)).resolves.toEqual([
            expect.objectContaining({
                id: grant.id,
                kind: 'RECOVERY',
                profiles: ['che'],
                allowsGeneralCreation: true,
                expiresAt: '2026-09-01T00:00:00.000Z',
                grantedByUserId: adminId,
            }),
        ]);

        const revoked = await users.revokeSpecialAccessGrant(userId, grant.id, {
            revokedAt: new Date('2026-08-20T00:00:00.000Z'),
            revokedByUserId: adminId,
            reason: 'Kakao 인증 복구 완료',
        });
        expect(revoked).toMatchObject({
            id: grant.id,
            revokedAt: '2026-08-20T00:00:00.000Z',
            revokedByUserId: adminId,
            revokedReason: 'Kakao 인증 복구 완료',
        });
        await expect(
            users.revokeSpecialAccessGrant(userId, grant.id, {
                revokedAt: new Date('2026-08-21T00:00:00.000Z'),
                revokedByUserId: adminId,
                reason: '중복 해제',
            })
        ).resolves.toBeNull();
    });
});
