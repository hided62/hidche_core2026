import { describe, expect, it } from 'vitest';

import { resolveLocalAccountProfilePolicy } from '../src/auth/localAccountPolicy.js';
import type { UserRecord } from '../src/auth/userRepository.js';

const buildLocalUser = (graceStartedAt: Date): UserRecord => ({
    id: 'local-user',
    username: 'local-user',
    displayName: '로컬유저',
    roles: ['user'],
    sanctions: {},
    oauthType: 'NONE',
    picture: 'default.jpg',
    imageServer: 0,
    thirdPartyUse: false,
    kakaoGraceStartedAt: graceStartedAt.toISOString(),
    passwordHash: 'unused',
    passwordSalt: '',
    createdAt: graceStartedAt.toISOString(),
});

describe('local account profile policy', () => {
    it.each(['che', 'kwe', 'twe'])('%s blocks general creation before Kakao verification', (profile) => {
        const now = new Date('2026-07-26T00:00:00.000Z');
        const policy = resolveLocalAccountProfilePolicy({
            profile,
            defaultGraceDays: 7,
            user: buildLocalUser(now),
            now,
        });

        expect(policy.accessAllowed).toBe(true);
        expect(policy.canCreateGeneral).toBe(false);
        expect(policy.generalCreationGraceDays).toBe(0);
    });

    it.each(['nya', 'pya', 'hwe'])('%s allows general creation during the configured grace period', (profile) => {
        const start = new Date('2026-07-20T00:00:00.000Z');
        const policy = resolveLocalAccountProfilePolicy({
            profile,
            defaultGraceDays: 7,
            user: buildLocalUser(start),
            now: new Date('2026-07-26T00:00:00.000Z'),
        });

        expect(policy.accessAllowed).toBe(true);
        expect(policy.canCreateGeneral).toBe(true);
        expect(policy.generalCreationGraceDays).toBe(7);
    });

    it('honors profile metadata overrides and blocks all access after expiry', () => {
        const policy = resolveLocalAccountProfilePolicy({
            profile: 'hwe',
            profileMeta: {
                localAccountAccessGraceDays: 3,
                localAccountGeneralCreationGraceDays: 1,
            },
            defaultGraceDays: 7,
            user: buildLocalUser(new Date('2026-07-20T00:00:00.000Z')),
            now: new Date('2026-07-26T00:00:00.000Z'),
        });

        expect(policy).toMatchObject({
            accessAllowed: false,
            canCreateGeneral: false,
            accessGraceDays: 3,
            generalCreationGraceDays: 1,
        });
    });

    it('removes grace restrictions once Kakao is verified', () => {
        const user = buildLocalUser(new Date('2020-01-01T00:00:00.000Z'));
        user.oauthType = 'KAKAO';
        user.oauthId = '1';
        user.email = 'verified@example.test';
        user.kakaoVerifiedAt = '2026-07-26T00:00:00.000Z';
        const policy = resolveLocalAccountProfilePolicy({
            profile: 'che',
            defaultGraceDays: 0,
            user,
            now: new Date('2026-07-26T00:00:00.000Z'),
        });

        expect(policy).toMatchObject({
            kakaoVerified: true,
            requiresKakaoVerification: false,
            accessAllowed: true,
            canCreateGeneral: true,
            graceEndsAt: null,
        });
    });

    it('extends account access with an administrator override without widening general creation grace', () => {
        const user = buildLocalUser(new Date('2026-07-20T00:00:00.000Z'));
        user.kakaoGraceUntil = '2026-08-20T00:00:00.000Z';
        const policy = resolveLocalAccountProfilePolicy({
            profile: 'che',
            defaultGraceDays: 7,
            user,
            now: new Date('2026-08-01T00:00:00.000Z'),
        });

        expect(policy).toMatchObject({
            accessAllowed: true,
            canCreateGeneral: false,
            graceEndsAt: '2026-08-20T00:00:00.000Z',
            generalCreationGraceDays: 0,
        });
    });
});
