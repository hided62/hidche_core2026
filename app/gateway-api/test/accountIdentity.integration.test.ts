import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGatewayPostgresConnector, type GatewayPrismaClient } from '@sammo-ts/infra';

import { createPostgresUserRepository } from '../src/auth/postgresUserRepository.js';

const databaseUrl = process.env.GATEWAY_RUNTIME_ACTION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const firstUserId = 'f28aa8ce-6bd0-45e5-a127-056de53e3161';
const secondUserId = '8f610116-64bd-4f18-bf7f-eae1737b227c';
const oldKakaoId = 'account-identity-old-kakao';
const newKakaoId = 'account-identity-new-kakao';

const assertDedicatedSchema = (): void => {
    const expected = process.env.GATEWAY_RUNTIME_INTEGRATION_SCHEMA;
    const actual = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') : null;
    if (!expected || !expected.endsWith('_gateway_runtime_integration') || actual !== expected) {
        throw new Error('Refusing to mutate a Gateway database outside the runner-owned integration schema.');
    }
};

integration('account identity PostgreSQL transaction', () => {
    let db: GatewayPrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        assertDedicatedSchema();
        const connector = createGatewayPostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.retiredKakaoIdentity.deleteMany({ where: { oauthId: { in: [oldKakaoId, newKakaoId] } } });
        await db.appUser.deleteMany({ where: { id: { in: [firstUserId, secondUserId] } } });
        await db.appUser.createMany({
            data: [
                {
                    id: firstUserId,
                    loginId: 'identity-integration-one',
                    displayName: '이름통합첫째',
                    passwordHash: 'not-used',
                    passwordSalt: 'not-used',
                    roles: ['user'],
                    sanctions: {},
                    oauthType: 'KAKAO',
                    oauthId: oldKakaoId,
                    email: 'identity-one@example.com',
                },
                {
                    id: secondUserId,
                    loginId: 'identity-integration-two',
                    displayName: '이름통합둘째',
                    passwordHash: 'not-used',
                    passwordSalt: 'not-used',
                    roles: ['user'],
                    sanctions: {},
                    oauthType: 'KAKAO',
                    oauthId: 'account-identity-second-kakao',
                    email: 'identity-two@example.com',
                },
            ],
        });
    });

    afterAll(async () => {
        await db?.retiredKakaoIdentity.deleteMany({ where: { oauthId: { in: [oldKakaoId, newKakaoId] } } });
        await db?.appUser.deleteMany({ where: { id: { in: [firstUserId, secondUserId] } } });
        await closeDb?.();
    });

    it('atomically retires the former Kakao ID and rejects its reuse', async () => {
        const users = createPostgresUserRepository(db);
        const verifiedAt = new Date('2026-08-24T12:00:00.000Z');
        await users.setKakaoReplacementApproval(firstUserId, {
            until: new Date('2026-08-24T13:00:00.000Z'),
            approvedByUserId: 'integration-admin',
            reason: '통합 테스트 교체 승인',
        });
        const replaced = await users.replaceKakaoWithApprovedIdentity(firstUserId, {
            oauthId: newKakaoId,
            email: 'identity-new@example.com',
            oauthInfo: { accessToken: 'not-a-real-token' },
            verifiedAt,
        });

        expect(replaced).toMatchObject({
            oauthId: newKakaoId,
            email: 'identity-new@example.com',
            authRevision: 1,
            sessionRevokedBefore: verifiedAt.toISOString(),
            kakaoReplacementApprovedUntil: undefined,
        });
        await expect(users.isKakaoIdentityRetired(oldKakaoId)).resolves.toBe(true);
        await expect(
            users.linkKakao(secondUserId, {
                oauthId: oldKakaoId,
                email: 'identity-two@example.com',
                oauthInfo: {},
                verifiedAt,
            })
        ).rejects.toThrow('permanently retired');

        await users.setKakaoReplacementApproval(secondUserId, {
            until: new Date('2026-08-24T13:00:00.000Z'),
            approvedByUserId: 'integration-admin',
            reason: '폐기 ID 재사용 거부',
        });
        await expect(
            users.replaceKakaoWithApprovedIdentity(secondUserId, {
                oauthId: oldKakaoId,
                email: 'identity-two-new@example.com',
                oauthInfo: {},
                verifiedAt,
            })
        ).rejects.toThrow();
        await expect(users.findById(secondUserId)).resolves.toMatchObject({
            oauthId: 'account-identity-second-kakao',
            email: 'identity-two@example.com',
        });
    });

    it('changes login ID and nickname together while preserving uniqueness', async () => {
        const users = createPostgresUserRepository(db);
        const before = await users.findById(firstUserId);
        const updated = await users.updateIdentity(firstUserId, {
            username: 'identity-integration-renamed',
            displayName: '이름통합변경',
            changedAt: new Date('2026-08-24T14:00:00.000Z'),
        });
        expect(updated).toMatchObject({
            username: 'identity-integration-renamed',
            displayName: '이름통합변경',
        });
        expect(Date.parse(updated.identityRevision ?? '')).toBeGreaterThan(Date.parse(before?.identityRevision ?? ''));
        await expect(
            users.updateIdentity(firstUserId, {
                username: 'identity-integration-two',
                displayName: '이름통합변경',
                changedAt: new Date('2026-08-24T14:00:01.000Z'),
            })
        ).rejects.toThrow();
    });
});
