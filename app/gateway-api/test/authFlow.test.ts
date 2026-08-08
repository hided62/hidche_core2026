import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { constants, publicEncrypt } from 'node:crypto';

import { InMemoryGatewaySessionService } from '../src/auth/inMemorySessionService.js';
import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';
import { InMemoryOAuthSessionStore } from '../src/auth/oauthSessionStore.js';
import type { KakaoOAuthClient } from '../src/auth/kakaoClient.js';
import { createGatewayApiContext } from '../src/context.js';
import { InMemoryProfileStatusService } from '../src/lobby/profileStatusService.js';
import { appRouter } from '../src/router.js';
import type { GatewayPrismaClient } from '@sammo-ts/infra';
import { decryptGameSessionToken, type UserSanctions } from '@sammo-ts/common/auth/gameToken';
import { createPasswordEnvelopeService } from '../src/auth/passwordEnvelope.js';

const buildCaller = (
    options: {
        userIconDir?: string;
        localAccountGraceDays?: number;
        flushError?: Error;
        profileListError?: Error;
        kakaoId?: string;
        kakaoEmail?: string;
        kakaoSignupAlreadyRegistered?: boolean;
        allowKakaoRefresh?: boolean;
    } = {}
) => {
    const users = createInMemoryUserRepository();
    const sessions = new InMemoryGatewaySessionService({
        sessionTtlSeconds: 3600,
        gameSessionTtlSeconds: 600,
    });
    const flushPublisher = {
        publishUserFlush: vi.fn(async () => {
            if (options.flushError) {
                throw options.flushError;
            }
        }),
    };
    const oauthSessions = new InMemoryOAuthSessionStore();
    const kakaoProfile = {
        id: options.kakaoId ?? '1',
        email: options.kakaoEmail ?? 'tester@example.com',
    };
    const sentTalkMessages: string[] = [];
    const refreshTokenCalls: string[] = [];
    const kakaoClient = {
        restKey: '',
        redirectUri: '',
        oauthHost: '',
        apiHost: '',
        buildAuthUrl: (state: string, scopes: string[]) =>
            `https://kauth.example.test/authorize?state=${state}&scope=${scopes.join(',')}`,
        exchangeCode: async () => ({
            accessToken: 'access-token',
            accessTokenExpiresIn: 3600,
            refreshToken: 'refresh-token',
            refreshTokenExpiresIn: 86400,
        }),
        refreshToken: async (refreshToken: string) => {
            refreshTokenCalls.push(refreshToken);
            if (!options.allowKakaoRefresh) {
                throw new Error('not used');
            }
            return {
                accessToken: 'refreshed-access-token',
                accessTokenExpiresIn: 3600,
            };
        },
        signup: async () =>
            options.kakaoSignupAlreadyRegistered
                ? { alreadyRegistered: true }
                : { id: kakaoProfile.id, alreadyRegistered: false },
        getMe: async () => ({
            id: kakaoProfile.id,
            kakaoAccount: {
                hasEmail: true,
                email: kakaoProfile.email,
                isEmailValid: true,
                isEmailVerified: true,
            },
        }),
        sendTalkMessage: async (_accessToken: string, message: string) => {
            sentTalkMessages.push(message);
        },
    };
    const profileRows = [
        {
            profileName: 'che:default',
            profile: 'che',
            scenario: 'default',
            apiPort: 15003,
            status: 'RUNNING' as const,
            buildStatus: 'SUCCEEDED' as const,
            meta: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
        {
            profileName: 'hwe:default',
            profile: 'hwe',
            scenario: 'default',
            apiPort: 15015,
            status: 'RUNNING' as const,
            buildStatus: 'SUCCEEDED' as const,
            meta: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
    ];
    const profiles = {
        listProfiles: async () => profileRows,
        getProfile: async (profileName: string) =>
            profileRows.find((profile) => profile.profileName === profileName) ?? null,
        upsertProfile: async () => {
            throw new Error('not used');
        },
        updateScenario: async () => null,
        updateStatus: async () => null,
        updateBuildStatus: async () => null,
        updateMeta: async () => null,
        listReservedToStart: async () => [],
        findQueuedBuild: async () => null,
        updateLastError: async () => {},
        updateWorkspaceUsage: async () => {},
        clearWorkspaceUsage: async () => {},
        listOperations: async () => [],
        getOperation: async () => null,
        createOperation: async () => {
            throw new Error('not implemented');
        },
        claimNextOperation: async () => null,
        completeOperation: async () => {
            throw new Error('not implemented');
        },
        requeueOperation: async () => {
            throw new Error('not implemented');
        },
        cancelOperation: async () => false,
        retryOperation: async () => null,
    };
    const orchestrator = {
        start: () => {},
        stop: async () => {},
        reconcileNow: async () => {},
        runScheduleNow: async () => {},
        runBuildQueueNow: async () => {},
        runOperationsNow: async () => {},
        cleanupStaleWorkspaces: async () => ({
            removed: [],
            skipped: [],
        }),
        listRuntimeStates: async () => [],
    };
    const profileStatus = new InMemoryProfileStatusService(
        profileRows.map((profile) => ({
            profileName: profile.profileName,
            profile: profile.profile,
            scenario: profile.scenario,
            status: profile.status,
            apiPort: profile.apiPort,
            runtime: {
                apiRunning: true,
                daemonRunning: true,
                auctionRunning: false,
                battleSimRunning: false,
                tournamentRunning: false,
            },
            korName: profile.profile,
            color: '#fff',
        }))
    );
    if (options.profileListError) {
        profileStatus.listLobbyProfiles = async () => {
            throw options.profileListError;
        };
    }
    const passwordEnvelope = createPasswordEnvelopeService();
    const requestHeaders: Record<string, string> = {};
    const userIconUpload = {
        upload: vi.fn(async ({ filename }: { filename: string }) => ({
            picture: `users/core2026/${filename}`,
            publicUrl: `https://sam-image.hided.net/icons/users/core2026/${filename}`,
        })),
    };
    const sealPassword = (password: string) => {
        const key = passwordEnvelope.getPublicKey();
        return {
            keyId: key.keyId,
            ciphertext: publicEncrypt(
                {
                    key: key.publicKeyPem,
                    padding: constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: 'sha256',
                },
                Buffer.from(password, 'utf8')
            ).toString('base64'),
        };
    };
    const caller = appRouter.createCaller(
        createGatewayApiContext({
            users,
            sessions,
            flushPublisher,
            gameTokenSecret: 'test-secret',
            gameSessionTtlSeconds: 600,
            kakaoClient: kakaoClient as unknown as KakaoOAuthClient,
            oauthSessions,
            publicBaseUrl: 'http://localhost',
            userIconDir: options.userIconDir,
            userIconPublicUrl: 'http://localhost/user-icons',
            sharedIconPublicUrl: 'https://sam-image.hided.net/icons',
            userIconUpload,
            adminLocalAccountEnabled: false,
            localRegistrationEnabled: true,
            localAccountGraceDays: options.localAccountGraceDays ?? 7,
            passwordEnvelope,
            profiles,
            orchestrator,
            profileStatus,
            requestHeaders,
            prisma: {
                appUser: {
                    findFirst: async () => null,
                },
            } as unknown as GatewayPrismaClient,
        })
    );
    return {
        caller,
        oauthSessions,
        users,
        sessions,
        flushPublisher,
        userIconUpload,
        kakaoProfile,
        sentTalkMessages,
        refreshTokenCalls,
        sealPassword,
        setSessionHeader: (sessionToken: string) => {
            requestHeaders['x-session-token'] = sessionToken;
        },
    };
};

describe('gateway auth flow', () => {
    it('registers a local account first and accepts an encrypted password login', async () => {
        const { caller, users, sealPassword } = buildCaller();
        const register = await caller.auth.registerLocal({
            username: 'LOCAL-User',
            credential: sealPassword('비밀번호-password'),
            displayName: '로컬유저',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });

        expect(register.user).toMatchObject({
            username: 'local-user',
            displayName: '로컬유저',
            kakaoVerified: false,
        });
        const stored = await users.findByUsername('local-user');
        expect(stored?.passwordHash.startsWith('$argon2id$')).toBe(true);
        expect(stored?.thirdPartyUse).toBe(false);
        expect(stored?.termsAcceptedAt).toBeTruthy();
        expect(stored?.privacyAcceptedAt).toBeTruthy();

        const login = await caller.auth.login({
            username: 'LOCAL-USER',
            credential: sealPassword('비밀번호-password'),
        });
        expect(login.status).toBe('login');
        if (login.status !== 'login') {
            throw new Error('Expected completed login.');
        }
        expect(login.user.username).toBe('local-user');
    });

    it('blocks password login while a ban is active and allows it after expiry', async () => {
        const { caller, users, sealPassword } = buildCaller();
        await caller.auth.registerLocal({
            username: 'banned-user',
            credential: sealPassword('banned-password'),
            displayName: '차단유저',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });
        const user = await users.findByUsername('banned-user');
        expect(user).not.toBeNull();
        await users.updateSanctions(user!.id, {
            bannedUntil: '2099-01-01T00:00:00.000Z',
        });

        await expect(
            caller.auth.login({
                username: 'banned-user',
                credential: sealPassword('banned-password'),
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });

        await users.updateSanctions(user!.id, {
            bannedUntil: '2000-01-01T00:00:00.000Z',
        });
        await expect(
            caller.auth.login({
                username: 'banned-user',
                credential: sealPassword('banned-password'),
            })
        ).resolves.toMatchObject({ user: { username: 'banned-user' } });
    });

    const gameSessionRestrictionCases: Array<{ label: string; sanctions: UserSanctions }> = [
        {
            label: 'global suspension',
            sanctions: { suspendedUntil: '2099-01-01T00:00:00.000Z' },
        },
        {
            label: 'profile login restriction',
            sanctions: {
                serverRestrictions: {
                    'che:default': {
                        blockedFeatures: ['login'],
                    },
                },
            },
        },
        {
            label: 'base profile gameplay restriction',
            sanctions: {
                serverRestrictions: {
                    che: {
                        blockedFeatures: ['gameplay'],
                        until: '2099-01-01T00:00:00.000Z',
                    },
                },
            },
        },
    ];

    it.each(gameSessionRestrictionCases)('blocks game-session issuance for $label', async ({ sanctions }) => {
        const { caller, users, sealPassword } = buildCaller();
        const register = await caller.auth.registerLocal({
            username: `restricted-${Object.keys(sanctions)[0]}`,
            credential: sealPassword('restricted-password'),
            displayName: '제한유저',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });
        const user = await users.findByUsername(register.user.username);
        expect(user).not.toBeNull();
        await users.updateSanctions(user!.id, sanctions);

        await expect(
            caller.auth.issueGameSession({
                sessionToken: register.sessionToken,
                profile: 'che:default',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('blocks pre-verification general creation on che but grants the hwe grace period', async () => {
        const { caller, sealPassword, setSessionHeader } = buildCaller();
        const register = await caller.auth.registerLocal({
            username: 'policy-user',
            credential: sealPassword('policy-password'),
            displayName: '정책유저',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });

        const che = await caller.auth.issueGameSession({
            sessionToken: register.sessionToken,
            profile: 'che:default',
        });
        const hwe = await caller.auth.issueGameSession({
            sessionToken: register.sessionToken,
            profile: 'hwe:default',
        });
        const chePayload = decryptGameSessionToken(che.gameToken, 'test-secret');
        const hwePayload = decryptGameSessionToken(hwe.gameToken, 'test-secret');

        expect(chePayload?.identity).toMatchObject({
            kakaoVerified: false,
            canCreateGeneral: false,
            requiresKakaoVerification: true,
        });
        expect(hwePayload?.identity).toMatchObject({
            kakaoVerified: false,
            canCreateGeneral: true,
            requiresKakaoVerification: true,
        });

        setSessionHeader(register.sessionToken);
        const profileList = await caller.lobby.profiles();
        expect(profileList.find((profile) => profile.profile === 'che')?.localAccountPolicy?.canCreateGeneral).toBe(
            false
        );
        expect(profileList.find((profile) => profile.profile === 'hwe')?.localAccountPolicy?.canCreateGeneral).toBe(
            true
        );
    });

    it('rejects continued game access after the local account grace period', async () => {
        const { caller, users, sealPassword } = buildCaller({ localAccountGraceDays: 7 });
        const register = await caller.auth.registerLocal({
            username: 'expired-user',
            credential: sealPassword('expired-password'),
            displayName: '만료유저',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });
        const user = await users.findByUsername('expired-user');
        expect(user).not.toBeNull();
        if (user) {
            user.kakaoGraceStartedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
        }

        await expect(
            caller.auth.issueGameSession({
                sessionToken: register.sessionToken,
                profile: 'hwe:default',
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
            message: expect.stringContaining('유예기간'),
        });
    });

    it('links Kakao to the logged-in local account instead of creating a second user', async () => {
        const { caller, users, sealPassword, setSessionHeader, sentTalkMessages } = buildCaller();
        const register = await caller.auth.registerLocal({
            username: 'verify-user',
            credential: sealPassword('verify-password'),
            displayName: '인증유저',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });
        setSessionHeader(register.sessionToken);
        const start = await caller.auth.kakaoStart({ mode: 'verify' });
        const verified = await caller.auth.kakaoExchange({
            code: 'oauth-code',
            state: start.state,
        });

        expect(verified.status).toBe('otp');
        if (verified.status !== 'otp') {
            throw new Error('Expected Kakao OTP challenge.');
        }
        const code = sentTalkMessages.at(-1)?.match(/인증 코드는 (\d{4})/)?.[1];
        expect(code).toBeTruthy();
        const completed = await caller.auth.kakaoOtp({ challengeId: verified.challengeId, code: code! });
        expect(completed.user.kakaoVerified).toBe(true);
        const stored = await users.findByUsername('verify-user');
        expect(stored).toMatchObject({
            oauthType: 'KAKAO',
            oauthId: '1',
            email: 'tester@example.com',
        });
        expect(stored?.kakaoVerifiedAt).toBeTruthy();
    });

    it('always requests both email and KakaoTalk message consent', async () => {
        const { caller } = buildCaller();

        const start = await caller.auth.kakaoStart({ mode: 'login', scopes: [] });

        expect(decodeURIComponent(start.authUrl)).toContain('scope=account_email,talk_message');
    });

    it('asks before relinking a new Kakao identity to the permanently retained email owner', async () => {
        const { caller, users, kakaoProfile, sentTalkMessages, flushPublisher } = buildCaller();
        const emailOwner = await users.createUser({
            username: 'email-owner',
            password: 'owner-password',
            oauth: {
                type: 'KAKAO',
                id: 'original-kakao-id',
                email: 'tester@example.com',
                info: {},
            },
        });
        await users.markKakaoTalkVerified(emailOwner.id, new Date(Date.now() + 60_000));
        kakaoProfile.id = 'different-kakao-id';

        const start = await caller.auth.kakaoStart({ mode: 'login' });
        const recovery = await caller.auth.kakaoExchange({ code: 'oauth-code', state: start.state });

        expect(recovery).toMatchObject({
            status: 'account_recovery',
            action: 'link_existing',
            email: 'tester@example.com',
        });
        if (recovery.status !== 'account_recovery') throw new Error('Expected account recovery choice.');

        const linked = await caller.auth.kakaoResolveAccount({
            oauthSessionId: recovery.oauthSessionId,
            action: 'link_existing',
        });
        expect(linked.status).toBe('otp');
        expect(sentTalkMessages).toHaveLength(1);
        expect(await users.findByOauthId('KAKAO', 'original-kakao-id')).toBeNull();
        expect(await users.findByOauthId('KAKAO', 'different-kakao-id')).toMatchObject({
            id: emailOwner.id,
            username: 'email-owner',
            email: 'tester@example.com',
        });
        expect(flushPublisher.publishUserFlush).toHaveBeenCalledWith(emailOwner.id, 'kakao-account-relinked');
    });

    it('asks for rejoin confirmation when Kakao is already registered but no retained email owner exists', async () => {
        const { caller, users, sealPassword } = buildCaller({ kakaoSignupAlreadyRegistered: true });

        const start = await caller.auth.kakaoStart({ mode: 'login' });
        const recovery = await caller.auth.kakaoExchange({ code: 'oauth-code', state: start.state });
        expect(recovery).toMatchObject({
            status: 'account_recovery',
            action: 'rejoin',
            email: 'tester@example.com',
        });
        if (recovery.status !== 'account_recovery') throw new Error('Expected rejoin choice.');

        const confirmed = await caller.auth.kakaoResolveAccount({
            oauthSessionId: recovery.oauthSessionId,
            action: 'rejoin',
        });
        expect(confirmed).toMatchObject({ status: 'join', email: 'tester@example.com' });
        if (confirmed.status !== 'join') throw new Error('Expected registration session.');

        const registered = await caller.auth.register({
            oauthSessionId: confirmed.oauthSessionId,
            username: 'rejoined-user',
            credential: sealPassword('rejoined-password'),
            displayName: '재가입사용자',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });
        expect(registered.status).toBe('otp');
        expect(await users.findByUsername('rejoined-user')).toMatchObject({
            oauthType: 'KAKAO',
            oauthId: '1',
            email: 'tester@example.com',
        });
    });

    it('does not let the registration mutation bypass the recovery confirmation', async () => {
        const { caller, users, sealPassword } = buildCaller();
        await users.createUser({
            username: 'retained-owner',
            password: 'owner-password',
            oauth: {
                type: 'KAKAO',
                id: 'former-kakao-id',
                email: 'tester@example.com',
                info: {},
            },
        });

        const start = await caller.auth.kakaoStart({ mode: 'login' });
        const recovery = await caller.auth.kakaoExchange({ code: 'oauth-code', state: start.state });
        if (recovery.status !== 'account_recovery') throw new Error('Expected account recovery choice.');

        await expect(
            caller.auth.register({
                oauthSessionId: recovery.oauthSessionId,
                username: 'bypass-user',
                credential: sealPassword('bypass-password'),
                displayName: '우회사용자',
                termsAgreed: true,
                privacyAgreed: true,
                thirdPartyUse: false,
            })
        ).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
            message: expect.stringContaining('복구 여부를 먼저 선택'),
        });
    });

    it('synchronizes a changed email by stable Kakao ID during Kakao login', async () => {
        const { caller, users, kakaoProfile } = buildCaller({
            kakaoId: 'stable-kakao-id',
            kakaoEmail: 'changed@example.com',
        });
        const user = await users.createUser({
            username: 'kakao-email-change',
            password: 'email-change-password',
            oauth: {
                type: 'KAKAO',
                id: 'stable-kakao-id',
                email: 'before@example.com',
                info: {},
            },
        });
        await users.markKakaoTalkVerified(user.id, new Date(Date.now() + 60_000));

        const start = await caller.auth.kakaoStart({ mode: 'login' });
        const login = await caller.auth.kakaoExchange({ code: 'oauth-code', state: start.state });

        expect(login.status).toBe('login');
        expect((await users.findById(user.id))?.email).toBe(kakaoProfile.email);
        expect(await users.findByEmail('before@example.com')).toBeNull();
    });

    it('checks Kakao identity and changed email on password login, then verifies the talk OTP', async () => {
        const { caller, users, sealPassword, kakaoProfile, sentTalkMessages } = buildCaller({
            kakaoId: 'password-login-kakao-id',
            kakaoEmail: 'after-password-login@example.com',
        });
        const user = await users.createUser({
            username: 'kakao-password-login',
            password: 'kakao-password',
            oauth: {
                type: 'KAKAO',
                id: kakaoProfile.id,
                email: 'before-password-login@example.com',
                info: {
                    accessToken: 'stored-access-token',
                    refreshToken: 'stored-refresh-token',
                    accessTokenValidUntil: new Date(Date.now() + 60_000).toISOString(),
                    refreshTokenValidUntil: new Date(Date.now() + 86_400_000).toISOString(),
                },
            },
        });

        const login = await caller.auth.login({
            username: user.username,
            credential: sealPassword('kakao-password'),
        });
        expect(login.status).toBe('otp');
        if (login.status !== 'otp') {
            throw new Error('Expected Kakao OTP challenge.');
        }
        expect((await users.findById(user.id))?.email).toBe(kakaoProfile.email);
        expect(sentTalkMessages).toHaveLength(1);

        await expect(caller.auth.kakaoOtp({ challengeId: login.challengeId, code: '0000' })).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
            message: expect.stringContaining('2회 더 시도'),
        });
        const code = sentTalkMessages[0]?.match(/인증 코드는 (\d{4})/)?.[1];
        expect(code).toBeTruthy();
        const completed = await caller.auth.kakaoOtp({ challengeId: login.challengeId, code: code! });
        expect(completed.validUntil).toBeTruthy();
        expect((await users.findById(user.id))?.kakaoTalkVerifiedUntil).toBe(completed.validUntil);

        const nextLogin = await caller.auth.login({
            username: user.username,
            credential: sealPassword('kakao-password'),
        });
        expect(nextLogin.status).toBe('login');
        expect(sentTalkMessages).toHaveLength(1);
    });

    it('refreshes an expired access token before the password-login identity check', async () => {
        const { caller, users, sealPassword, kakaoProfile, refreshTokenCalls } = buildCaller({
            kakaoId: 'refresh-kakao-id',
            kakaoEmail: 'refreshed-email@example.com',
            allowKakaoRefresh: true,
        });
        const user = await users.createUser({
            username: 'refresh-kakao-user',
            password: 'refresh-kakao-password',
            oauth: {
                type: 'KAKAO',
                id: kakaoProfile.id,
                email: 'old-refresh-email@example.com',
                info: {
                    accessToken: 'expired-access-token',
                    refreshToken: 'usable-refresh-token',
                    accessTokenValidUntil: new Date(Date.now() - 60_000).toISOString(),
                    refreshTokenValidUntil: new Date(Date.now() + 86_400_000).toISOString(),
                },
            },
        });

        const login = await caller.auth.login({
            username: user.username,
            credential: sealPassword('refresh-kakao-password'),
        });

        expect(login.status).toBe('otp');
        expect(refreshTokenCalls).toEqual(['usable-refresh-token']);
        expect(await users.findById(user.id)).toMatchObject({
            email: 'refreshed-email@example.com',
            oauthInfo: {
                accessToken: 'refreshed-access-token',
                refreshToken: 'usable-refresh-token',
            },
        });
    });

    it('rejects password-login email synchronization when the changed email belongs to another user', async () => {
        const { caller, users, sealPassword, kakaoProfile } = buildCaller({
            kakaoId: 'conflicting-email-kakao-id',
            kakaoEmail: 'occupied@example.com',
        });
        const user = await users.createUser({
            username: 'conflicting-email-user',
            password: 'conflicting-email-password',
            oauth: {
                type: 'KAKAO',
                id: kakaoProfile.id,
                email: 'previous@example.com',
                info: {
                    accessToken: 'stored-access-token',
                    accessTokenValidUntil: new Date(Date.now() + 60_000).toISOString(),
                },
            },
        });
        await users.createUser({
            username: 'occupied-email-owner',
            password: 'occupied-email-password',
            oauth: {
                type: 'KAKAO',
                id: 'other-kakao-id',
                email: kakaoProfile.email,
                info: {},
            },
        });

        await expect(
            caller.auth.login({
                username: user.username,
                credential: sealPassword('conflicting-email-password'),
            })
        ).rejects.toMatchObject({
            code: 'CONFLICT',
            message: expect.stringContaining('이미 다른 계정에서 사용 중'),
        });
        expect((await users.findById(user.id))?.email).toBe('previous@example.com');
    });

    it('reuses the active challenge and blocks retries after three wrong OTP values', async () => {
        const { caller, users, sealPassword, kakaoProfile, sentTalkMessages } = buildCaller({
            kakaoId: 'attempt-limit-kakao-id',
        });
        const user = await users.createUser({
            username: 'attempt-limit-user',
            password: 'attempt-limit-password',
            oauth: {
                type: 'KAKAO',
                id: kakaoProfile.id,
                email: kakaoProfile.email,
                info: {
                    accessToken: 'stored-access-token',
                    accessTokenValidUntil: new Date(Date.now() + 60_000).toISOString(),
                },
            },
        });
        const login = await caller.auth.login({
            username: user.username,
            credential: sealPassword('attempt-limit-password'),
        });
        expect(login.status).toBe('otp');
        if (login.status !== 'otp') {
            throw new Error('Expected Kakao OTP challenge.');
        }

        for (const remaining of [2, 1, 0]) {
            await expect(caller.auth.kakaoOtp({ challengeId: login.challengeId, code: '0000' })).rejects.toMatchObject({
                code: 'UNAUTHORIZED',
                message:
                    remaining > 0 ? expect.stringContaining(`${remaining}회 더 시도`) : expect.stringContaining('초과'),
            });
        }
        const retried = await caller.auth.login({
            username: user.username,
            credential: sealPassword('attempt-limit-password'),
        });
        expect(retried).toMatchObject({ status: 'otp', challengeId: login.challengeId, attemptsRemaining: 0 });
        expect(sentTalkMessages).toHaveLength(1);
    });

    it('blocks Kakao login while a ban is active', async () => {
        const { caller, users, sealPassword, setSessionHeader } = buildCaller();
        const register = await caller.auth.registerLocal({
            username: 'kakao-banned-user',
            credential: sealPassword('kakao-banned-password'),
            displayName: '카카오제재유저',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });
        setSessionHeader(register.sessionToken);
        const verifyStart = await caller.auth.kakaoStart({ mode: 'verify' });
        await caller.auth.kakaoExchange({
            code: 'oauth-code',
            state: verifyStart.state,
        });

        const stored = await users.findByUsername('kakao-banned-user');
        expect(stored).not.toBeNull();
        if (stored) {
            await users.updateSanctions(stored.id, {
                bannedUntil: new Date(Date.now() + 60_000).toISOString(),
            });
        }

        const loginStart = await caller.auth.kakaoStart({ mode: 'login' });
        await expect(
            caller.auth.kakaoExchange({
                code: 'oauth-code',
                state: loginStart.state,
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
            message: 'Account login is blocked.',
        });
    });

    it('carries the bootstrap superuser role into game sessions', async () => {
        const previousToken = process.env.GATEWAY_BOOTSTRAP_TOKEN;
        process.env.GATEWAY_BOOTSTRAP_TOKEN = 'bootstrap-test-token';
        try {
            const { caller } = buildCaller();
            const bootstrap = await caller.auth.bootstrapLocal({
                token: 'bootstrap-test-token',
                username: 'admin',
                password: 'secretpass',
                displayName: 'Admin',
            });

            expect(bootstrap.user.roles).toEqual(['superuser']);

            const issued = await caller.auth.issueGameSession({
                sessionToken: bootstrap.sessionToken,
                profile: 'che:default',
            });
            const payload = decryptGameSessionToken(issued.gameToken, 'test-secret');

            expect(payload?.user.roles).toEqual(['superuser']);
        } finally {
            if (previousToken === undefined) {
                delete process.env.GATEWAY_BOOTSTRAP_TOKEN;
            } else {
                process.env.GATEWAY_BOOTSTRAP_TOKEN = previousToken;
            }
        }
    });

    it('registers and issues a game session', async () => {
        const { caller, oauthSessions, sealPassword, sentTalkMessages } = buildCaller();
        const oauthSession = await oauthSessions.createSession({
            mode: 'login',
            kakaoId: '1',
            email: 'tester@example.com',
            accessToken: 'token',
            refreshToken: 'refresh',
            accessTokenValidUntil: new Date().toISOString(),
            refreshTokenValidUntil: new Date().toISOString(),
            createdAt: new Date().toISOString(),
        });
        const register = await caller.auth.register({
            oauthSessionId: oauthSession.id,
            username: 'tester',
            credential: sealPassword('secretpass'),
            displayName: 'Tester',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });

        expect(register.status).toBe('otp');
        if (register.status !== 'otp') {
            throw new Error('Expected Kakao OTP challenge.');
        }
        const code = sentTalkMessages.at(-1)?.match(/인증 코드는 (\d{4})/)?.[1];
        expect(code).toBeTruthy();
        const completed = await caller.auth.kakaoOtp({ challengeId: register.challengeId, code: code! });
        expect(completed.user.username).toBe('tester');
        expect(completed.sessionToken).toBeTruthy();

        const issued = await caller.auth.issueGameSession({
            sessionToken: completed.sessionToken,
            profile: 'che:default',
        });

        expect(issued.profile).toBe('che:default');
        expect(issued.gameToken).toBeTruthy();

        const validated = await caller.auth.validateGameSession({
            profile: 'che:default',
            gameToken: issued.gameToken,
        });

        expect(validated?.user.username).toBe('tester');
    });

    it('keeps the migrated member number inside the encrypted game identity', async () => {
        const { caller, users, sessions } = buildCaller();
        const user = await users.createUser({
            username: 'legacy-seed-user',
            password: 'secretpass',
        });
        user.legacyMemberNo = 42;
        const session = await sessions.createSession(user);

        const issued = await caller.auth.issueGameSession({
            sessionToken: session.sessionToken,
            profile: 'che:default',
        });
        const payload = decryptGameSessionToken(issued.gameToken, 'test-secret');

        expect(payload?.user.legacyMemberNo).toBe(42);
        const validated = await caller.auth.validateGameSession({
            profile: 'che:default',
            gameToken: issued.gameToken,
        });
        expect(validated).toMatchObject({
            user: {
                id: user.id,
            },
        });
        expect(validated?.user).not.toHaveProperty('legacyMemberNo');
    });

    it('issues each game token from the latest user roles, sanctions, and icon', async () => {
        const { caller, users, sessions } = buildCaller();
        const user = await users.createUser({
            username: 'fresh-game-identity',
            password: 'secretpass',
        });
        user.legacyGrade = 0;
        const session = await sessions.createSession(user);

        await users.updateRoles(user.id, ['user', 'latest-role']);
        await users.updateSanctions(user.id, {
            warningCount: 2,
            legacyPenalty: {
                any: {
                    chat: { expire: 4_102_444_800, value: 1 },
                },
            },
        });
        await users.updateIcon(user.id, 'latest-owner.webp', 3, new Date('2026-07-30T12:00:00.000Z'));

        const issued = await caller.auth.issueGameSession({
            sessionToken: session.sessionToken,
            profile: 'che:default',
        });
        const payload = decryptGameSessionToken(issued.gameToken, 'test-secret');

        expect(payload?.user).toMatchObject({
            id: user.id,
            roles: ['user', 'latest-role'],
            picture: 'latest-owner.webp',
            imageServer: 3,
            iconUpdatedAt: '2026-07-30T12:00:00.000Z',
            canUseGeneralPicture: false,
        });
        expect(payload?.sanctions).toMatchObject({
            warningCount: 2,
            legacyPenalty: {
                any: {
                    chat: { expire: 4_102_444_800, value: 1 },
                },
            },
        });
    });

    it('revokes the gateway session and every linked game session on logout', async () => {
        const { caller, users, sessions } = buildCaller();
        const user = await users.createUser({
            username: 'logout-user',
            password: 'secretpass',
        });
        const session = await sessions.createSession(user);
        const gameSession = await sessions.createGameSession(session.sessionToken, 'che:default');
        expect(gameSession).not.toBeNull();

        await caller.auth.logout({ sessionToken: session.sessionToken });

        expect(await sessions.getSession(session.sessionToken)).toBeNull();
        expect(
            gameSession ? await sessions.getGameSession(gameSession.profile, gameSession.gameToken) : undefined
        ).toBeNull();
    });
});

describe('account self service', () => {
    it('changes only the authenticated user password after verifying the current password', async () => {
        const { caller, users, sessions, sealPassword } = buildCaller();
        const user = await users.createUser({
            username: 'self-service',
            password: 'current-password',
        });
        const session = await sessions.createSession(user);

        await expect(
            caller.account.changePassword({
                sessionToken: session.sessionToken,
                currentCredential: sealPassword('wrong-password'),
                newCredential: sealPassword('next-password'),
            })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

        await caller.account.changePassword({
            sessionToken: session.sessionToken,
            currentCredential: sealPassword('current-password'),
            newCredential: sealPassword('next-password'),
        });

        const refreshed = await users.findById(user.id);
        expect(refreshed && (await users.verifyPassword(refreshed, 'next-password'))).toBe(true);
    });

    it('revokes the session and schedules deletion after 30 days', async () => {
        const { caller, users, sessions, sealPassword } = buildCaller();
        const user = await users.createUser({
            username: 'delete-self',
            password: 'current-password',
        });
        const session = await sessions.createSession(user);

        const result = await caller.account.scheduleDeletion({
            sessionToken: session.sessionToken,
            currentCredential: sealPassword('current-password'),
        });

        expect(new Date(result.deleteAfter).getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
        expect((await users.findById(user.id))?.deleteAfter).toBe(result.deleteAfter);
        expect(await sessions.getSession(session.sessionToken)).toBeNull();
    });

    it('revokes third-party use consent without allowing it to be re-enabled', async () => {
        const { caller, users, sessions } = buildCaller();
        const user = await users.createUser({
            username: 'privacy-self',
            password: 'current-password',
        });
        const session = await sessions.createSession(user);

        await caller.account.disallowThirdPartyUse({ sessionToken: session.sessionToken });

        expect((await users.findById(user.id))?.thirdPartyUse).toBe(false);
    });

    it('validates and stores a legacy-sized account icon with a daily change limit', async () => {
        const iconDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-account-icon-'));
        try {
            const { caller, users, sessions, flushPublisher, userIconUpload } = buildCaller({
                userIconDir: iconDir,
            });
            const user = await users.createUser({
                username: 'icon-self',
                password: 'current-password',
            });
            const session = await sessions.createSession(user);
            const png = await sharp({
                create: {
                    width: 64,
                    height: 64,
                    channels: 4,
                    background: '#334455',
                },
            })
                .png()
                .toBuffer();

            const result = await caller.account.changeIcon({
                sessionToken: session.sessionToken,
                imageData: `data:image/png;base64,${png.toString('base64')}`,
            });
            const updated = await users.findById(user.id);
            const account = await caller.account.get({ sessionToken: session.sessionToken });

            expect(result.iconUrl).toMatch(
                /^https:\/\/sam-image\.hided\.net\/icons\/users\/core2026\/[a-f0-9]{32}\.png$/
            );
            expect(result.profiles.map((profile) => profile.profileName)).toEqual(['che:default', 'hwe:default']);
            expect(account?.icons[0]?.url).toMatch(
                /^https:\/\/sam-image\.hided\.net\/icons\/users\/core2026\/[a-f0-9]{32}\.png$/
            );
            expect(updated?.imageServer).toBe(0);
            expect(flushPublisher.publishUserFlush).toHaveBeenCalledWith(user.id, 'account-icon-changed');
            expect(userIconUpload.upload).toHaveBeenCalledWith(
                expect.objectContaining({ contentType: 'image/png', body: png })
            );
            await expect(caller.account.deleteIcon({ sessionToken: session.sessionToken })).rejects.toMatchObject({
                code: 'TOO_MANY_REQUESTS',
            });
        } finally {
            await fs.rm(iconDir, { recursive: true, force: true });
        }
    });

    it('atomically allows only one icon change per KST day and removes the losing file', async () => {
        const iconDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-account-icon-race-'));
        try {
            const { caller, users, sessions } = buildCaller({ userIconDir: iconDir });
            const user = await users.createUser({
                username: 'icon-race',
                password: 'current-password',
            });
            const session = await sessions.createSession(user);
            const png = await sharp({
                create: {
                    width: 64,
                    height: 64,
                    channels: 4,
                    background: '#556677',
                },
            })
                .png()
                .toBuffer();
            const attempts = await Promise.allSettled(
                [1, 2].map(() =>
                    caller.account.changeIcon({
                        sessionToken: session.sessionToken,
                        imageData: `data:image/png;base64,${png.toString('base64')}`,
                    })
                )
            );

            expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
            expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
            expect(await users.listIcons(user.id)).toHaveLength(1);
        } finally {
            await fs.rm(iconDir, { recursive: true, force: true });
        }
    });

    it('flushes an account icon deletion with selectable running profiles', async () => {
        const { caller, users, sessions, flushPublisher } = buildCaller();
        const user = await users.createUser({
            username: 'icon-delete',
            password: 'current-password',
        });
        await users.updateIcon(user.id, 'old.png', 1, new Date('2026-07-30T12:00:00.000Z'));
        const session = await sessions.createSession(user);

        const result = await caller.account.deleteIcon({ sessionToken: session.sessionToken });
        const updated = await users.findById(user.id);

        expect(result).toMatchObject({
            ok: true,
            iconUrl: null,
            profiles: [{ profileName: 'che:default' }, { profileName: 'hwe:default' }],
        });
        expect(updated).toMatchObject({ picture: 'default.jpg', imageServer: 0 });
        expect(flushPublisher.publishUserFlush).toHaveBeenCalledWith(user.id, 'account-icon-deleted');
    });

    it('uses a rolling 24-hour upload window and preserves delete-to-upload behavior', async () => {
        const iconDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-account-icon-kst-'));
        const png = await sharp({
            create: {
                width: 64,
                height: 64,
                channels: 4,
                background: '#667788',
            },
        })
            .png()
            .toBuffer();
        try {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-07-31T14:59:59.000Z'));
            const { caller, users, sessions } = buildCaller({ userIconDir: iconDir });
            const user = await users.createUser({
                username: 'icon-kst',
                password: 'current-password',
            });
            await users.updateIcon(user.id, 'old.png', 1, new Date('2026-07-31T00:00:00.000Z'));
            const session = await sessions.createSession(user);

            await expect(caller.account.deleteIcon({ sessionToken: session.sessionToken })).rejects.toMatchObject({
                code: 'TOO_MANY_REQUESTS',
            });

            vi.setSystemTime(new Date('2026-07-31T15:00:00.000Z'));
            await expect(caller.account.deleteIcon({ sessionToken: session.sessionToken })).rejects.toMatchObject({
                code: 'TOO_MANY_REQUESTS',
            });

            vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
            const nextSession = await sessions.createSession(user);
            const deleted = await caller.account.deleteIcon({ sessionToken: nextSession.sessionToken });
            expect(deleted.revision).toBe('2026-08-01T00:00:00.000Z');

            const changed = await caller.account.changeIcon({
                sessionToken: nextSession.sessionToken,
                imageData: `data:image/png;base64,${png.toString('base64')}`,
            });
            expect(new Date(changed.revision).getTime()).toBeGreaterThan(new Date(deleted.revision).getTime());
            expect((await users.findById(user.id))?.picture).not.toBe('default.jpg');
        } finally {
            vi.useRealTimers();
            await fs.rm(iconDir, { recursive: true, force: true });
        }
    });

    it('does not commit an icon when profile discovery fails before mutation', async () => {
        const iconDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-account-icon-profile-failure-'));
        try {
            const { caller, users, sessions } = buildCaller({
                userIconDir: iconDir,
                profileListError: new Error('profile unavailable'),
            });
            const user = await users.createUser({
                username: 'icon-profile-failure',
                password: 'current-password',
            });
            const session = await sessions.createSession(user);
            const png = await sharp({
                create: { width: 64, height: 64, channels: 4, background: '#778899' },
            })
                .png()
                .toBuffer();

            await expect(
                caller.account.changeIcon({
                    sessionToken: session.sessionToken,
                    imageData: `data:image/png;base64,${png.toString('base64')}`,
                })
            ).rejects.toThrow('profile unavailable');
            expect(await fs.readdir(iconDir)).toEqual([]);
            expect(await users.findById(user.id)).toMatchObject({
                picture: 'default.jpg',
                imageServer: 0,
            });
        } finally {
            await fs.rm(iconDir, { recursive: true, force: true });
        }
    });

    it('returns a recoverable success when flush publication fails after commit', async () => {
        const iconDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-account-icon-flush-failure-'));
        try {
            const { caller, users, sessions } = buildCaller({
                userIconDir: iconDir,
                flushError: new Error('redis unavailable'),
            });
            const user = await users.createUser({
                username: 'icon-flush-failure',
                password: 'current-password',
            });
            const session = await sessions.createSession(user);
            const png = await sharp({
                create: { width: 64, height: 64, channels: 4, background: '#8899aa' },
            })
                .png()
                .toBuffer();

            const changed = await caller.account.changeIcon({
                sessionToken: session.sessionToken,
                imageData: `data:image/png;base64,${png.toString('base64')}`,
            });
            expect(changed.flushPublished).toBe(false);
            expect((await users.findById(user.id))?.picture).not.toBe('default.jpg');

            await expect(caller.account.prepareIconSync({ sessionToken: session.sessionToken })).resolves.toMatchObject(
                {
                    projection: {
                        revision: changed.revision,
                        imageServer: 0,
                    },
                    profiles: [{ profileName: 'che:default' }, { profileName: 'hwe:default' }],
                }
            );
        } finally {
            await fs.rm(iconDir, { recursive: true, force: true });
        }
    });
});
