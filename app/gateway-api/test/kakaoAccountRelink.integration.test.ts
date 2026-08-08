import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGatewayPostgresConnector, type GatewayPrismaClient } from '@sammo-ts/infra';

import { createPostgresUserRepository } from '../src/auth/postgresUserRepository.js';

const databaseUrl = process.env.GATEWAY_RUNTIME_ACTION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const userId = '3dd08c49-279e-41ad-a12b-51b914cc51c8';

const assertDedicatedSchema = (): void => {
    const expected = process.env.GATEWAY_RUNTIME_INTEGRATION_SCHEMA;
    const actual = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') : null;
    if (!expected || !expected.endsWith('_gateway_runtime_integration') || actual !== expected) {
        throw new Error('Refusing to mutate a Gateway database outside the runner-owned integration schema.');
    }
};

integration('Kakao account relink PostgreSQL boundary', () => {
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
                loginId: 'kakao-relink-integration',
                displayName: '카카오 재연결 통합',
                passwordHash: 'not-used',
                passwordSalt: 'not-used',
                roles: ['user'],
                sanctions: {},
                oauthType: 'KAKAO',
                oauthId: 'former-kakao-id',
                email: 'retained@example.test',
                kakaoVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
                kakaoTalkVerifiedUntil: new Date('2026-08-20T00:00:00.000Z'),
            },
        });
    });

    afterAll(async () => {
        if (initialized) {
            await db.appUser.deleteMany({ where: { id: userId } });
        }
        await closeDb?.();
    });

    it('relinks the new provider identity while preserving email ownership and resetting the old talk proof', async () => {
        const users = createPostgresUserRepository(db);
        const linked = await users.relinkKakaoByEmail(userId, {
            oauthId: 'replacement-kakao-id',
            email: 'retained@example.test',
            oauthInfo: {
                accessToken: 'replacement-access-token',
                accessTokenValidUntil: '2026-08-08T12:00:00.000Z',
            },
            verifiedAt: new Date('2026-08-08T10:00:00.000Z'),
        });

        expect(linked).toMatchObject({
            id: userId,
            oauthType: 'KAKAO',
            oauthId: 'replacement-kakao-id',
            email: 'retained@example.test',
            kakaoTalkVerifiedUntil: undefined,
        });
        await expect(users.findByOauthId('KAKAO', 'former-kakao-id')).resolves.toBeNull();
        await expect(users.findByOauthId('KAKAO', 'replacement-kakao-id')).resolves.toMatchObject({ id: userId });
    });
});
