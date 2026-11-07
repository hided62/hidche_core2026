import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGatewayPostgresConnector, type GatewayPrismaClient } from '@sammo-ts/infra';

import { snapshotKakaoLink } from '../src/auth/kakaoLinkPolicy.js';
import { createPostgresUserRepository } from '../src/auth/postgresUserRepository.js';

const databaseUrl = process.env.GATEWAY_RUNTIME_ACTION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const firstUserId = 'f28aa8ce-6bd0-45e5-a127-056de53e3161';
const secondUserId = '8f610116-64bd-4f18-bf7f-eae1737b227c';
const bootstrapId = '00000000-0000-4000-8000-000000000042';
const selfUserId = '00000000-0000-4000-8000-000000000043';
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
        await db.kakaoIdentityLinkHistory.deleteMany({
            where: { userId: { in: [firstUserId, secondUserId, selfUserId] } },
        });
        await db.appUser.deleteMany({ where: { id: { in: [firstUserId, secondUserId, bootstrapId, selfUserId] } } });
        await db.appUser.createMany({
            data: [
                {
                    id: bootstrapId,
                    loginId: 'identity-bootstrap',
                    displayName: '복구통합관리자',
                    passwordHash: 'not-used',
                    passwordSalt: 'not-used',
                    roles: ['superuser'],
                    sanctions: {},
                    createdAt: new Date('2000-01-01'),
                },
                {
                    id: selfUserId,
                    loginId: 'identity-self',
                    displayName: '직접복구계정',
                    passwordHash: 'not-used',
                    passwordSalt: 'not-used',
                    roles: ['user'],
                    sanctions: {},
                    oauthType: 'KAKAO',
                    oauthId: 'self-db-old',
                    email: 'self-db@example.test',
                },
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
        await db?.kakaoIdentityLinkHistory.deleteMany({
            where: { userId: { in: [firstUserId, secondUserId, selfUserId] } },
        });
        await db?.appUser.deleteMany({ where: { id: { in: [firstUserId, secondUserId, bootstrapId, selfUserId] } } });
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
    it('cancels only the authenticated deletion snapshot once and persists the new auth revision', async () => {
        const users = createPostgresUserRepository(db);
        const deadline = new Date(Date.now() + 86400000);
        await users.scheduleDeletion(firstUserId, deadline);
        const before = await users.findById(firstUserId);
        const revision = before?.authRevision ?? 0;
        expect(await users.cancelDeletion(firstUserId, new Date(deadline.getTime() - 1).toISOString(), revision)).toBe(
            false
        );
        expect(await users.cancelDeletion(firstUserId, deadline.toISOString(), revision + 1)).toBe(false);
        const results = await Promise.all([
            users.cancelDeletion(firstUserId, deadline.toISOString(), revision),
            users.cancelDeletion(firstUserId, deadline.toISOString(), revision),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
        const restored = await users.findById(firstUserId);
        expect(restored?.deleteAfter).toBeUndefined();
        expect(restored?.authRevision).toBe(revision + 1);
        expect(restored?.oauthId).toBe(before?.oauthId);
        expect(restored?.sanctions).toEqual(before?.sanctions);
    });
    it('commits identity, imported password, proof and history together, and restricts former identities to their owner', async () => {
        const users = createPostgresUserRepository(db);
        await db.appUser.update({ where: { id: selfUserId }, data: { passwordResetRequired: true } });
        const before = await users.findById(selfUserId);
        const now = new Date();
        const input = {
            expected: snapshotKakaoLink(before!),
            authorization: 'EMAIL' as const,
            oauthId: 'self-db-new',
            email: 'self-db@example.test',
            oauthInfo: {},
            verifiedAt: now,
            talkVerifiedUntil: new Date(now.getTime() + 86400000),
            password: 'new-self-password',
        };
        const restored = await users.completeKakaoIdentityLink(selfUserId, input);
        expect(restored).toMatchObject({
            oauthId: 'self-db-new',
            passwordResetRequired: false,
            authRevision: (before?.authRevision ?? 0) + 1,
        });
        expect(await users.verifyPassword(restored, 'new-self-password')).toBe(true);
        expect(await users.findDetachedKakaoOwner('self-db-old')).toBe(selfUserId);
        expect(await users.isKakaoIdentityRetired('self-db-old')).toBe(false);
        expect(await db.kakaoIdentityLinkHistory.count({ where: { userId: selfUserId } })).toBe(1);
        await expect(users.completeKakaoIdentityLink(selfUserId, input)).rejects.toThrow();
        await expect(
            users.createUser({
                username: 'identity-history-claim',
                password: 'secretpass',
                oauth: { type: 'KAKAO', id: 'self-db-old', email: 'claim@example.test', info: {} },
            })
        ).rejects.toThrow();
        const prior = await users.findById(selfUserId);
        await users.completeKakaoIdentityLink(selfUserId, {
            ...input,
            expected: snapshotKakaoLink(prior!),
            oauthId: 'self-db-old',
        });
        expect((await users.findById(selfUserId))?.oauthId).toBe('self-db-old');
        const snapshot = await users.findById(selfUserId);
        const conflicting = await users.findById(secondUserId);
        await expect(
            users.completeKakaoIdentityLink(selfUserId, {
                ...input,
                expected: snapshotKakaoLink(snapshot!),
                oauthId: conflicting!.oauthId!,
                password: 'must-not-be-saved',
            })
        ).rejects.toThrow();
        expect((await users.findById(selfUserId))?.passwordHash).toBe(snapshot?.passwordHash);
        expect(await db.kakaoIdentityLinkHistory.count({ where: { userId: selfUserId } })).toBe(2);
        await expect(
            users.markKakaoTalkVerified(selfUserId, new Date(Date.now() + 10000), 0, 'self-db-old')
        ).rejects.toThrow();
    });

    it('allows only one concurrent recovery against the same PostgreSQL snapshot', async () => {
        const users = createPostgresUserRepository(db);
        const user = await users.findById(selfUserId);
        const input = {
            expected: snapshotKakaoLink(user!),
            authorization: 'EMAIL' as const,
            email: 'self-db@example.test',
            oauthInfo: {},
            verifiedAt: new Date(),
            talkVerifiedUntil: new Date(Date.now() + 86400000),
        };
        const results = await Promise.allSettled(
            ['self-db-race-one', 'self-db-race-two'].map((oauthId) =>
                users.completeKakaoIdentityLink(selfUserId, { ...input, oauthId })
            )
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
        expect((await users.findById(selfUserId))?.authRevision).toBe((user?.authRevision ?? 0) + 1);
    });
    it('keeps former identity ownership after the service account is deleted', async () => {
        const users = createPostgresUserRepository(db);
        await users.deleteUser(selfUserId);
        expect(await users.findDetachedKakaoOwner('self-db-old')).toBe(selfUserId);
        await expect(
            users.createUser({
                username: 'deleted-owner-claim',
                password: 'secretpass',
                oauth: { type: 'KAKAO', id: 'self-db-old', email: 'deleted-owner-claim@example.test', info: {} },
            })
        ).rejects.toThrow();
    });
});
