import { describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { trpcJsonBodyHttpServerOptions } from '@sammo-ts/common';
import { canCancelDeletion } from '../src/auth/deletionRecovery.js';
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
import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';
import { createPasswordEnvelopeService } from '../src/auth/passwordEnvelope.js';
import type { GatewayProfileRepository } from '../src/orchestrator/profileRepository.js';

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
            instanceKey: 'default',
            currentScenario: null,
            scenario: 'default',
            apiPort: 15003,
            status: 'RUNNING' as const,
            buildStatus: 'SUCCEEDED' as const,
            buildCommitSha: 'HEAD',
            meta: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
        {
            profileName: 'hwe:default',
            profile: 'hwe',
            instanceKey: 'default',
            currentScenario: null,
            scenario: 'default',
            apiPort: 15015,
            status: 'RUNNING' as const,
            buildStatus: 'SUCCEEDED' as const,
            buildCommitSha: 'HEAD',
            meta: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
    ];
    const profiles: GatewayProfileRepository = {
        listProfiles: async () => profileRows,
        getProfile: async (profileName: string) =>
            profileRows.find((profile) => profile.profileName === profileName) ?? null,
        upsertProfile: async () => {
            throw new Error('not used');
        },
        updateCurrentScenario: async () => null,
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
        listOperationLogs: async () => [],
        appendOperationLog: async (operationId, input) => ({
            cursor: '1',
            operationId,
            createdAt: '2026-08-11T00:00:00.000Z',
            ...input,
        }),
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
        transitionProfileClock: async (_profileName: string, action: 'SUSPEND' | 'RESUME') => ({
            phase: action === 'SUSPEND' ? 'SUSPENDED' : 'RUNNING',
            revision: 1,
        }),
        listRuntimeStates: async () => [],
    };
    const profileStatus = new InMemoryProfileStatusService(
        profileRows.map((profile) => ({
            profileName: profile.profileName,
            profile: profile.profile,
            instanceKey: profile.instanceKey,
            currentScenario: profile.currentScenario,
            scenario: profile.scenario,
            status: profile.status,
            lifecycle: {
                runtimeExpected: true,
                userAccessible: true,
                turnsRunning: true,
                operatorResumable: false,
                dataInitialized: profile.currentScenario !== null,
            },
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
    const context = createGatewayApiContext({
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
    });
    const caller = appRouter.createCaller(context);
    return {
        context,
        caller,
        oauthSessions,
        users,
        sessions,
        flushPublisher,
        userIconUpload,
        kakaoProfile,
        kakaoClient,
        sentTalkMessages,
        refreshTokenCalls,
        sealPassword,
        setSessionHeader: (sessionToken: string) => {
            requestHeaders['x-session-token'] = sessionToken;
        },
    };
};

describe('gateway auth flow', () => {
    it('allows a signed-in regular user to read only the active profile scenario catalog', async () => {
        const { caller, sealPassword, setSessionHeader } = buildCaller();

        await expect(caller.lobby.scenarios({ profileName: 'che:default' })).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });

        const register = await caller.auth.registerLocal({
            username: 'scenario-reader',
            credential: sealPassword('scenario-reader-password'),
            displayName: '시나리오조회자',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });
        setSessionHeader(register.sessionToken);

        const scenarios = await caller.lobby.scenarios({ profileName: 'che:default' });
        expect(scenarios.length).toBeGreaterThan(0);
        expect(scenarios[0]).toMatchObject({
            id: expect.any(Number),
            title: expect.any(String),
            defaultStatTotal: expect.any(Number),
        });
        await expect(caller.lobby.scenarios({ profileName: 'hidden:default' })).rejects.toMatchObject({
            code: 'NOT_FOUND',
        });
    });

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

    it('issues a CHE game token to an expired tester with an active special access grant', async () => {
        const { caller, users, sealPassword } = buildCaller({ localAccountGraceDays: 0 });
        const register = await caller.auth.registerLocal({
            username: 'special-tester',
            credential: sealPassword('tester-password'),
            displayName: '특수테스터',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });
        const user = await users.findByUsername('special-tester');
        expect(user).not.toBeNull();
        if (!user) throw new Error('Expected local tester.');
        await users.createSpecialAccessGrant(user.id, {
            kind: 'TESTER',
            profiles: ['che'],
            allowsGeneralCreation: true,
            expiresAt: null,
            reason: 'CHE 회귀 검증',
            grantedByUserId: 'admin-id',
        });

        const issued = await caller.auth.issueGameSession({
            sessionToken: register.sessionToken,
            profile: 'che:default',
        });
        const payload = decryptGameSessionToken(issued.gameToken, 'test-secret');

        expect(payload?.identity).toMatchObject({
            kakaoVerified: false,
            canCreateGeneral: true,
            requiresKakaoVerification: false,
            specialAccess: { kind: 'TESTER', expiresAt: null },
        });
    });

    it('lets a Kakao-linked recovery account log in with its password while the grant is active', async () => {
        const { caller, users, sealPassword } = buildCaller();
        await caller.auth.registerLocal({
            username: 'lost-phone-user',
            credential: sealPassword('recovery-password'),
            displayName: '분실복구유저',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });
        const user = await users.findByUsername('lost-phone-user');
        expect(user).not.toBeNull();
        if (!user) throw new Error('Expected recovery user.');
        user.oauthType = 'KAKAO';
        user.oauthId = 'lost-phone-kakao-id';
        user.kakaoVerifiedAt = '2026-08-01T00:00:00.000Z';
        await users.createSpecialAccessGrant(user.id, {
            kind: 'RECOVERY',
            profiles: ['che'],
            allowsGeneralCreation: true,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            reason: '휴대폰 분실 본인 확인 완료',
            grantedByUserId: 'admin-id',
        });

        await expect(
            caller.auth.login({
                username: 'lost-phone-user',
                credential: sealPassword('recovery-password'),
            })
        ).resolves.toMatchObject({ status: 'login', user: { username: 'lost-phone-user' } });
    });

    it('lets a Kakao-linked operator log in with its password without a grant', async () => {
        const { caller, users, sealPassword } = buildCaller();
        await caller.auth.registerLocal({
            username: 'oauth-free-operator',
            credential: sealPassword('operator-password'),
            displayName: '복구운영자',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });
        const user = await users.findByUsername('oauth-free-operator');
        expect(user).not.toBeNull();
        if (!user) throw new Error('Expected operator user.');
        user.oauthType = 'KAKAO';
        user.oauthId = 'operator-kakao-id';
        user.kakaoVerifiedAt = '2026-08-01T00:00:00.000Z';
        await users.updateRoles(user.id, ['user', 'admin.users.manage']);

        await expect(
            caller.auth.login({
                username: 'oauth-free-operator',
                credential: sealPassword('operator-password'),
            })
        ).resolves.toMatchObject({ status: 'login', user: { username: 'oauth-free-operator' } });
    });

    it('keeps an active server sanction authoritative over special access', async () => {
        const { caller, users, sealPassword } = buildCaller({ localAccountGraceDays: 0 });
        const register = await caller.auth.registerLocal({
            username: 'sanctioned-special-tester',
            credential: sealPassword('tester-password'),
            displayName: '제재특수테스터',
            termsAgreed: true,
            privacyAgreed: true,
            thirdPartyUse: false,
        });
        const user = await users.findByUsername('sanctioned-special-tester');
        expect(user).not.toBeNull();
        if (!user) throw new Error('Expected sanctioned local tester.');
        await users.createSpecialAccessGrant(user.id, {
            kind: 'TESTER',
            profiles: ['che'],
            allowsGeneralCreation: true,
            expiresAt: null,
            reason: 'CHE 회귀 검증',
            grantedByUserId: 'admin-id',
        });
        await users.updateSanctions(user.id, {
            serverRestrictions: {
                che: {
                    blockedFeatures: ['login'],
                    until: '2099-01-01T00:00:00.000Z',
                },
            },
        });

        await expect(
            caller.auth.issueGameSession({
                sessionToken: register.sessionToken,
                profile: 'che:default',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
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
        const choice = await caller.auth.kakaoExchange({
            code: 'oauth-code',
            state: start.state,
        });

        if (choice.status !== 'account_recovery') throw new Error('Expected link confirmation.');
        const verified = await caller.auth.kakaoLinkWithPassword({
            oauthSessionId: choice.oauthSessionId,
            username: 'verify-user',
            credential: sealPassword('verify-password'),
        });
        expect(verified.status).toBe('otp');
        if (verified.status !== 'otp') {
            throw new Error('Expected Kakao OTP challenge.');
        }
        const code = sentTalkMessages.at(-1)?.match(/인증 코드는 (\d{4})/)?.[1];
        expect(code).toBeTruthy();
        const completed = await caller.auth.kakaoOtp({ challengeId: verified.challengeId, code: code! });
        if (completed.status !== 'login') throw new Error('Expected login.');
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
        const { caller, users, kakaoProfile, sealPassword, sentTalkMessages, flushPublisher } = buildCaller();
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
        emailOwner.passwordResetRequired = true;
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
        expect(linked.status).toBe('password_setup');
        if (linked.status !== 'password_setup') throw new Error('Expected migrated password setup.');
        expect(sentTalkMessages).toHaveLength(0);
        const passwordSet = await caller.auth.kakaoSetPassword({
            oauthSessionId: linked.oauthSessionId,
            credential: sealPassword('replacement-password'),
        });
        expect(passwordSet.status).toBe('otp');
        expect(sentTalkMessages).toHaveLength(1);
        expect(await users.findByOauthId('KAKAO', 'original-kakao-id')).toMatchObject({ id: emailOwner.id });
        expect((await users.findById(emailOwner.id))?.passwordResetRequired).toBe(true);
        if (passwordSet.status !== 'otp') throw new Error('Expected OTP.');
        const code = sentTalkMessages.at(-1)?.match(/인증 코드는 (\d{4})/)?.[1];
        await caller.auth.kakaoOtp({ challengeId: passwordSet.challengeId, code: code! });
        expect(await users.findByOauthId('KAKAO', 'original-kakao-id')).toBeNull();
        expect(await users.isKakaoIdentityRetired('original-kakao-id')).toBe(false);
        expect(await users.findDetachedKakaoOwner('original-kakao-id')).toBe(emailOwner.id);
        expect(await users.findByOauthId('KAKAO', 'different-kakao-id')).toMatchObject({ id: emailOwner.id });
        expect(flushPublisher.publishUserFlush).toHaveBeenCalledWith(emailOwner.id, 'kakao-account-relinked');
    });

    it('requires a one-time password setup before an imported Kakao account can receive a session', async () => {
        const { caller, users, sessions, kakaoProfile, sealPassword, sentTalkMessages } = buildCaller({
            kakaoId: 'imported-kakao-id',
            kakaoEmail: 'imported@example.com',
        });
        const user = await users.createUser({
            username: 'imported-kakao-user',
            password: 'legacy-password',
            oauth: {
                type: 'KAKAO',
                id: kakaoProfile.id,
                email: kakaoProfile.email,
                info: {},
            },
        });
        user.passwordResetRequired = true;
        const createSession = vi.spyOn(sessions, 'createSession');

        const start = await caller.auth.kakaoStart({ mode: 'login' });
        const login = await caller.auth.kakaoExchange({ code: 'oauth-code', state: start.state });
        expect(login).toMatchObject({
            status: 'password_setup',
            email: 'imported@example.com',
            successStatus: 'login',
        });
        if (login.status !== 'password_setup') throw new Error('Expected migrated password setup.');
        expect(login).not.toHaveProperty('sessionToken');
        expect(createSession).not.toHaveBeenCalled();
        expect(sentTalkMessages).toHaveLength(0);

        const setup = await caller.auth.kakaoSetPassword({
            oauthSessionId: login.oauthSessionId,
            credential: sealPassword('new-imported-password'),
        });
        expect(setup.status).toBe('otp');
        expect((await users.findById(user.id))?.passwordResetRequired).toBe(false);
        expect(await users.verifyPassword(user, 'new-imported-password')).toBe(true);
        await expect(
            caller.auth.kakaoSetPassword({
                oauthSessionId: login.oauthSessionId,
                credential: sealPassword('another-password'),
            })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('rechecks sanctions before consuming a migrated password setup', async () => {
        const { caller, users, kakaoProfile, sealPassword } = buildCaller({
            kakaoId: 'sanctioned-setup-id',
            kakaoEmail: 'sanctioned-setup@example.com',
        });
        const user = await users.createUser({
            username: 'sanctioned-setup-user',
            password: 'legacy-password',
            oauth: { type: 'KAKAO', id: kakaoProfile.id, email: kakaoProfile.email, info: {} },
        });
        user.passwordResetRequired = true;
        const start = await caller.auth.kakaoStart({ mode: 'login' });
        const login = await caller.auth.kakaoExchange({ code: 'oauth-code', state: start.state });
        if (login.status !== 'password_setup') throw new Error('Expected migrated password setup.');
        await users.updateSanctions(user.id, { bannedUntil: '2099-01-01T00:00:00.000Z' });

        await expect(
            caller.auth.kakaoSetPassword({
                oauthSessionId: login.oauthSessionId,
                credential: sealPassword('blocked-password'),
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect((await users.findById(user.id))?.passwordResetRequired).toBe(true);
    });

    it('consumes password setup when the provider identity changes before submission', async () => {
        const { caller, users, kakaoProfile, sealPassword } = buildCaller({
            kakaoId: 'setup-target-id',
            kakaoEmail: 'setup-target@example.com',
        });
        const user = await users.createUser({
            username: 'setup-target-user',
            password: 'legacy-password',
            oauth: { type: 'KAKAO', id: kakaoProfile.id, email: kakaoProfile.email, info: {} },
        });
        user.passwordResetRequired = true;
        const start = await caller.auth.kakaoStart({ mode: 'login' });
        const login = await caller.auth.kakaoExchange({ code: 'oauth-code', state: start.state });
        if (login.status !== 'password_setup') throw new Error('Expected migrated password setup.');
        kakaoProfile.id = 'changed-provider-id';

        await expect(
            caller.auth.kakaoSetPassword({
                oauthSessionId: login.oauthSessionId,
                credential: sealPassword('new-target-password'),
            })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        expect((await users.findById(user.id))?.passwordResetRequired).toBe(true);
        await expect(
            caller.auth.kakaoSetPassword({
                oauthSessionId: login.oauthSessionId,
                credential: sealPassword('new-target-password'),
            })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
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

    it('completes an approved administrator replacement only after fresh talk proof and keeps old-ID ownership', async () => {
        const f = buildCaller({ kakaoId: 'new-kakao-id', kakaoEmail: 'new-kakao@example.com' });
        const user = await f.users.createUser({
            username: 'approved-replacement-user',
            password: 'replacement-password',
            oauth: { type: 'KAKAO', id: 'old-kakao-id', email: 'old-kakao@example.com', info: {} },
        });
        await f.users.updateRoles(user.id, ['admin']);
        await f.users.setKakaoReplacementApproval(user.id, {
            until: new Date(Date.now() + 60000),
            approvedByUserId: 'operator',
            reason: '본인 확인 완료',
        });
        const old = await f.sessions.createSession(user);
        f.setSessionHeader(old.sessionToken);
        const start = await f.caller.auth.kakaoStart({ mode: 'verify' });
        const choice = await f.caller.auth.kakaoExchange({ code: 'code', state: start.state });
        if (choice.status !== 'account_recovery') throw new Error('Expected confirmation.');
        const otp = await f.caller.auth.kakaoResolveAccount({
            oauthSessionId: choice.oauthSessionId,
            action: 'link_existing',
        });
        if (otp.status !== 'otp') throw new Error('Expected OTP.');
        expect((await f.users.findById(user.id))?.oauthId).toBe('old-kakao-id');
        expect(await f.caller.auth.me({ sessionToken: old.sessionToken })).not.toBeNull();
        const code = f.sentTalkMessages.at(-1)?.match(/인증 코드는 (\d{4})/)?.[1];
        await f.caller.auth.kakaoOtp({ challengeId: otp.challengeId, code: code! });
        expect(await f.users.findById(user.id)).toMatchObject({
            oauthId: 'new-kakao-id',
            authRevision: 1,
            kakaoReplacementApprovedUntil: undefined,
        });
        expect(await f.users.isKakaoIdentityRetired('old-kakao-id')).toBe(false);
        expect(await f.users.findDetachedKakaoOwner('old-kakao-id')).toBe(user.id);
        expect(await f.caller.auth.me({ sessionToken: old.sessionToken })).toBeNull();
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
        expect(sentTalkMessages[0]).toBe(
            `인증 코드는 ${code} 입니다. ${formatServerDateTime(login.expiresAt)} (한국 시간) 이내에 입력해 주세요.`
        );
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
        const { caller, users } = buildCaller();
        await users.createUser({
            username: 'kakao-banned-user',
            password: 'kakao-banned-password',
            oauth: { type: 'KAKAO', id: '1', email: 'tester@example.com', info: {} },
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
        if (completed.status !== 'login') throw new Error('Expected login.');
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

    it('starts token age before the user snapshot so a concurrent role flush can revoke stale identity', async () => {
        const { caller, users, sessions } = buildCaller();
        const user = await users.createUser({ username: 'role-snapshot-race', password: 'synthetic-password' });
        const parent = await sessions.createSession(user);
        const issuedAt = new Date().toISOString();
        vi.useFakeTimers({ now: new Date(issuedAt) });
        const original = users.findById.bind(users);
        const find = vi.spyOn(users, 'findById').mockImplementationOnce(async (id) => {
            const snapshot = await original(id);
            vi.advanceTimersByTime(5000); // admin mutation/flush arrives after the snapshot.
            return snapshot;
        });
        try {
            const result = await caller.auth.issueGameSession({
                sessionToken: parent.sessionToken,
                profile: 'che:default',
            });
            expect(decryptGameSessionToken(result.gameToken, 'test-secret')?.issuedAt).toBe(issuedAt);
        } finally {
            find.mockRestore();
            vi.useRealTimers();
        }
    });

    it('retains the original issuance instant when logout flush overlaps later identity reads', async () => {
        const { caller, users, sessions } = buildCaller();
        const user = await users.createUser({ username: 'issue-flush-race', password: 'synthetic-password' });
        const parent = await sessions.createSession(user);
        const issuedAt = new Date().toISOString();
        vi.useFakeTimers({ now: new Date(issuedAt) });
        const create = vi.spyOn(sessions, 'createGameSession');
        const original = sessions.createGameSession.bind(sessions);
        create.mockImplementationOnce(async (...args) => {
            // Snapshot admitted before the subsequent logout/flush instant.
            const game = await original(...args);
            vi.advanceTimersByTime(5_000);
            await sessions.revokeSession(parent.sessionToken);
            return game;
        });
        try {
            const issued = await caller.auth.issueGameSession({
                sessionToken: parent.sessionToken,
                profile: 'che:default',
            });
            const payload = decryptGameSessionToken(issued.gameToken, 'test-secret');
            expect(payload?.issuedAt).toBe(issuedAt);
            expect(payload?.expiresAt).toBe(new Date(Date.parse(issuedAt) + 600_000).toISOString());
        } finally {
            create.mockRestore();
            vi.useRealTimers();
        }
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
        user.passwordResetRequired = true;
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
        expect(refreshed?.passwordResetRequired).toBe(false);
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
            await expect(caller.account.deleteIcon({ sessionToken: session.sessionToken })).resolves.toMatchObject({
                ok: true,
                iconUrl: null,
            });
        } finally {
            await fs.rm(iconDir, { recursive: true, force: true });
        }
    });

    it('stores AVIF account icons with the public AVIF extension and media type', async () => {
        const iconDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-account-icon-avif-'));
        try {
            const { caller, users, sessions, userIconUpload } = buildCaller({ userIconDir: iconDir });
            const user = await users.createUser({
                username: 'icon-avif',
                password: 'current-password',
            });
            const session = await sessions.createSession(user);
            const avif = await sharp({
                create: { width: 64, height: 64, channels: 4, background: '#334455' },
            })
                .avif()
                .toBuffer();

            const result = await caller.account.changeIcon({
                sessionToken: session.sessionToken,
                imageData: `data:image/avif;base64,${avif.toString('base64')}`,
            });

            expect(result.iconUrl).toMatch(
                /^https:\/\/sam-image\.hided\.net\/icons\/users\/core2026\/[a-f0-9]{32}\.avif$/
            );
            expect(userIconUpload.upload).toHaveBeenCalledWith(
                expect.objectContaining({ contentType: 'image/avif', body: avif })
            );
        } finally {
            await fs.rm(iconDir, { recursive: true, force: true });
        }
    });

    it('bounds pending icon uploads without changing the owned library limit', async () => {
        const { caller, users, sessions, userIconUpload } = buildCaller();
        const user = await users.createUser({ username: 'icon-budget', password: 'current-password' });
        const session = await sessions.createSession(user);
        const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#224466' } })
            .png()
            .toBuffer();
        const input = {
            sessionToken: session.sessionToken,
            imageData: `data:image/png;base64,${png.toString('base64')}`,
        };
        const pending: Array<() => void> = [];
        userIconUpload.upload.mockImplementation(
            ({ filename }) =>
                new Promise((resolve) => {
                    pending.push(() =>
                        resolve({
                            picture: `users/core2026/${filename}`,
                            publicUrl: `https://image.example/${filename}`,
                        })
                    );
                })
        );
        const admitted = Array.from({ length: 4 }, () => caller.account.changeIcon(input));
        try {
            await vi.waitFor(() => expect(userIconUpload.upload).toHaveBeenCalledTimes(4));
            await expect(caller.account.changeIcon(input)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
        } finally {
            pending.forEach((done) => done());
            await Promise.all(admitted);
        }
        expect(await users.listIcons(user.id)).toHaveLength(4);
        userIconUpload.upload.mockImplementation(async ({ filename }) => ({
            picture: `users/core2026/${filename}`,
            publicUrl: `https://image.example/${filename}`,
        }));
        await expect(caller.account.changeIcon(input)).resolves.toMatchObject({ ok: true });
        expect(await users.listIcons(user.id)).toHaveLength(5);
    });

    it('accepts concurrent uploads until the five-icon limit is reached', async () => {
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

            expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(2);
            expect(await users.listIcons(user.id)).toHaveLength(2);
        } finally {
            await fs.rm(iconDir, { recursive: true, force: true });
        }
    });

    it('limits only owned library retirement to one icon per rolling 24 hours', async () => {
        const { caller, users, sessions } = buildCaller();
        const now = new Date('2026-08-01T00:00:00.000Z');
        const png = await sharp({
            create: { width: 64, height: 64, channels: 4, background: '#556677' },
        })
            .png()
            .toBuffer();
        const imageData = `data:image/png;base64,${png.toString('base64')}`;
        try {
            vi.useFakeTimers();
            vi.setSystemTime(now);
            const owner = await users.createUser({ username: 'icon-retirement-owner', password: 'password' });
            const other = await users.createUser({ username: 'icon-retirement-other', password: 'password' });
            const ownerSession = await sessions.createSession(owner);
            const otherSession = await sessions.createSession(other);
            const first = await caller.account.changeIcon({ sessionToken: ownerSession.sessionToken, imageData });
            const second = await caller.account.changeIcon({ sessionToken: ownerSession.sessionToken, imageData });

            await expect(
                caller.account.retireIcon({
                    sessionToken: otherSession.sessionToken,
                    iconId: first.icon.id,
                })
            ).rejects.toMatchObject({ code: 'NOT_FOUND' });
            await caller.account.retireIcon({ sessionToken: ownerSession.sessionToken, iconId: first.icon.id });
            expect(await caller.account.get({ sessionToken: ownerSession.sessionToken })).toMatchObject({
                nextUploadAt: null,
                nextRetireAt: new Date(now.getTime() + 86_400_000).toISOString(),
            });

            vi.setSystemTime(new Date(now.getTime() + 86_400_000 - 1));
            const nextOwnerSession = await sessions.createSession(owner);
            await expect(
                caller.account.retireIcon({
                    sessionToken: nextOwnerSession.sessionToken,
                    iconId: second.icon.id,
                })
            ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
            vi.setSystemTime(new Date(now.getTime() + 86_400_000));
            await expect(
                caller.account.retireIcon({
                    sessionToken: nextOwnerSession.sessionToken,
                    iconId: second.icon.id,
                })
            ).resolves.toMatchObject({ ok: true });
        } finally {
            vi.useRealTimers();
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

    it('allows a default-icon reset and another upload within the same day', async () => {
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

            const deleted = await caller.account.deleteIcon({ sessionToken: session.sessionToken });
            expect(deleted.revision).toBe('2026-07-31T14:59:59.001Z');

            const changed = await caller.account.changeIcon({
                sessionToken: session.sessionToken,
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

describe('account deletion cancellation', () => {
    const pendingLogin = async () => {
        const f = buildCaller();
        const user = await f.users.createUser({ username: 'recover-user', password: 'secretpass' });
        const other = await f.users.createUser({ username: 'other-recover-user', password: 'secretpass' });
        const oldSession = await f.sessions.createSession(user);
        const deadline = new Date(Date.now() + 30 * 86400000);
        await f.caller.account.scheduleDeletion({
            sessionToken: oldSession.sessionToken,
            currentCredential: f.sealPassword('secretpass'),
        });
        const result = await f.caller.auth.login({ username: user.username, credential: f.sealPassword('secretpass') });
        if (result.status !== 'deletion_pending') throw new Error('Expected deletion confirmation.');
        return { ...f, user, other, oldSession, deadline, result };
    };

    it('authenticates before offering cancellation and restores only the proved account once', async () => {
        const f = await pendingLogin();
        await expect(
            f.caller.auth.login({ username: f.user.username, credential: f.sealPassword('wrongpass') })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        expect(f.result).not.toHaveProperty('sessionToken');
        expect(await f.sessions.getSession(f.oldSession.sessionToken)).toBeNull();
        const restored = await f.caller.auth.cancelDeletion({ recoveryId: f.result.recoveryId });
        expect(restored.status).toBe('login');
        if (restored.status !== 'login') throw new Error('Expected login.');
        expect((await f.users.findById(f.user.id))?.deleteAfter).toBeUndefined();
        expect((await f.users.findById(f.user.id))?.authRevision).toBe(1);
        expect((await f.sessions.getSession(restored.sessionToken))?.userId).toBe(f.user.id);
        expect((await f.users.findById(f.other.id))?.authRevision).toBe(0);
        expect(f.flushPublisher.publishUserFlush).toHaveBeenCalledWith(f.user.id, 'account-deletion-cancelled');
        await expect(f.caller.auth.cancelDeletion({ recoveryId: f.result.recoveryId })).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
    });

    it.each(['rescheduled', 'expired-proof', 'sanctioned', 'deleted'] as const)(
        'rejects a %s recovery without clearing deletion',
        async (kind) => {
            const f = await pendingLogin();
            if (kind === 'rescheduled') await f.users.scheduleDeletion(f.user.id, new Date(Date.now() + 60 * 86400000));
            if (kind === 'sanctioned')
                await f.users.updateSanctions(f.user.id, {
                    bannedUntil: new Date(Date.now() + 86400000).toISOString(),
                });
            if (kind === 'deleted') await f.users.deleteUser(f.user.id);
            if (kind === 'expired-proof') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 301000);
            try {
                await expect(f.caller.auth.cancelDeletion({ recoveryId: f.result.recoveryId })).rejects.toBeDefined();
            } finally {
                vi.restoreAllMocks();
            }
            if (kind !== 'deleted') expect((await f.users.findById(f.user.id))?.deleteAfter).toBeDefined();
            expect(f.flushPublisher.publishUserFlush).not.toHaveBeenCalledWith(f.user.id, 'account-deletion-cancelled');
        }
    );

    it('requires a proof, rejects actor injection and verifies actual HTTP transport', async () => {
        const f = await pendingLogin();
        const app = fastify();
        await app.register(fastifyTRPCPlugin, {
            prefix: '/gateway/api/trpc',
            trpcOptions: { router: appRouter, ...trpcJsonBodyHttpServerOptions, createContext: () => f.context },
        });
        try {
            const address = await app.listen({ host: '127.0.0.1', port: 0 });
            const post = (input: object) =>
                fetch(`${address}/gateway/api/trpc/auth.cancelDeletion`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(input),
                });
            expect((await post({})).status).toBe(400);
            expect((await post({ recoveryId: 'not-a-uuid' })).status).toBe(400);
            expect((await post({ recoveryId: '11111111-1111-4111-8111-111111111111' })).status).toBe(401);
            expect((await post({ recoveryId: f.result.recoveryId, userId: f.other.id })).status).toBe(400);
            expect((await post({ recoveryId: f.result.recoveryId })).status).toBe(200);
            expect((await post({ recoveryId: f.result.recoveryId })).status).toBe(401);
        } finally {
            await app.close();
        }
    });

    it.each([
        [false, false],
        [true, false],
        [false, true],
        [true, true],
    ])(
        'supports pending Kakao accounts after existing-email linking=%s, legacy=%s and OTP proof',
        async (linkByEmail, legacy) => {
            const f = buildCaller();
            const user = await f.users.createUser({
                username: 'kakao-recover',
                password: 'secretpass',
                oauth: { type: 'KAKAO', id: linkByEmail ? 'former-id' : '1', email: 'tester@example.com', info: {} },
            });
            if (linkByEmail)
                await f.users.setKakaoReplacementApproval(user.id, {
                    until: new Date(Date.now() + 60000),
                    approvedByUserId: 'operator',
                    reason: '본인 확인 완료',
                });
            if (legacy) {
                user.legacyMemberNo = 42;
                user.passwordResetRequired = true;
            }
            await f.users.scheduleDeletion(
                user.id,
                legacy ? new Date('2026-07-30T14:59:59.999Z') : new Date(Date.now() + 86400000)
            );
            const start = await f.caller.auth.kakaoStart({ mode: 'login' });
            let result = await f.caller.auth.kakaoExchange({ code: 'test-code', state: start.state });
            if (linkByEmail) {
                if (result.status !== 'account_recovery') throw new Error('Expected account link confirmation.');
                result = await f.caller.auth.kakaoResolveAccount({
                    oauthSessionId: result.oauthSessionId,
                    action: 'link_existing',
                });
            }
            if (legacy) {
                if (result.status !== 'password_setup') throw new Error('Expected migrated password setup.');
                result = await f.caller.auth.kakaoSetPassword({
                    oauthSessionId: result.oauthSessionId,
                    credential: f.sealPassword('restoredpass'),
                });
            }
            if (result.status !== 'otp') throw new Error('Expected OTP proof.');
            expect((await f.users.findById(user.id))?.deleteAfter).toBeDefined();
            const code = f.sentTalkMessages.at(-1)?.match(/인증 코드는 (\d{4})/)?.[1];
            const verified = await f.caller.auth.kakaoOtp({ challengeId: result.challengeId, code: code! });
            if (verified.status !== 'deletion_pending') throw new Error('Expected deletion confirmation.');
            expect(verified).not.toHaveProperty('sessionToken');
            expect((await f.users.findById(user.id))?.deleteAfter).toBeDefined();
            expect((await f.caller.auth.cancelDeletion({ recoveryId: verified.recoveryId })).status).toBe('login');
        }
    );

    it('applies the pre-July legacy request exception at the exact Korean-time boundary', async () => {
        const f = buildCaller();
        const user = await f.users.createUser({ username: 'legacy-recover', password: 'secretpass' });
        user.legacyMemberNo = 42;
        const cutoffDeadline = new Date('2026-07-31T00:00:00+09:00');
        await f.users.scheduleDeletion(user.id, new Date(cutoffDeadline.getTime() - 1));
        const legacy = await f.users.findById(user.id);
        expect(canCancelDeletion(legacy!, new Date('2026-11-07'))).toBe(true);
        const result = await f.caller.auth.login({ username: user.username, credential: f.sealPassword('secretpass') });
        if (result.status !== 'deletion_pending') throw new Error('Expected legacy restoration.');
        await f.caller.auth.cancelDeletion({ recoveryId: result.recoveryId });
        await f.users.scheduleDeletion(user.id, cutoffDeadline);
        await expect(
            f.caller.auth.login({ username: user.username, credential: f.sealPassword('secretpass') })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(canCancelDeletion({ ...legacy!, legacyMemberNo: undefined }, new Date('2026-11-07'))).toBe(false);
    });
});

describe('staged Kakao self recovery', () => {
    const prepare = async (
        options: { differentEmail?: boolean; resetPassword?: boolean; privileged?: boolean } = {}
    ) => {
        const f = buildCaller({
            kakaoId: 'new-self-kakao',
            kakaoEmail: options.differentEmail ? 'new@example.test' : 'owner@example.test',
        });
        const user = await f.users.createUser({
            username: 'self-recover',
            password: 'originalpass',
            oauth: { type: 'KAKAO', id: 'old-self-kakao', email: 'owner@example.test', info: {} },
        });
        if (options.privileged) await f.users.updateRoles(user.id, ['admin']);
        user.passwordResetRequired = options.resetPassword ?? false;
        user.kakaoTalkVerifiedUntil = new Date(Date.now() + 86400000).toISOString();
        const old = await f.sessions.createSession(user);
        const start = await f.caller.auth.kakaoStart({ mode: 'login' });
        const choice = await f.caller.auth.kakaoExchange({ code: 'code', state: start.state });
        return { ...f, user, old, choice };
    };
    const otpCode = (f: { sentTalkMessages: string[] }): string =>
        f.sentTalkMessages.at(-1)!.match(/인증 코드는 (\d{4})/)![1]!;

    it('recovers an ordinary matching-email account without approval and only commits after fresh OTP', async () => {
        const f = await prepare();
        if (f.choice.status !== 'account_recovery') throw new Error('Expected confirmation.');
        const oldChallenge = await f.oauthSessions.createLoginChallenge({
            userId: f.user.id,
            code: '1111',
            attemptsRemaining: 3,
            expiresAt: new Date(Date.now() + 180000).toISOString(),
            createdAt: new Date().toISOString(),
            authRevision: 0,
            oauthId: 'old-self-kakao',
        });
        const otp = await f.caller.auth.kakaoResolveAccount({
            oauthSessionId: f.choice.oauthSessionId,
            action: 'link_existing',
        });
        if (otp.status !== 'otp') throw new Error('Expected fresh OTP despite a cached proof.');
        expect((await f.users.findById(f.user.id))?.oauthId).toBe('old-self-kakao');
        expect(await f.caller.auth.me({ sessionToken: f.old.sessionToken })).not.toBeNull();
        expect(await f.users.findDetachedKakaoOwner('old-self-kakao')).toBeNull();
        await expect(f.caller.auth.kakaoOtp({ challengeId: otp.challengeId, code: '0000' })).rejects.toBeDefined();
        expect((await f.users.findById(f.user.id))?.oauthId).toBe('old-self-kakao');
        expect((await f.caller.auth.kakaoOtp({ challengeId: otp.challengeId, code: otpCode(f) })).status).toBe('login');
        expect(await f.caller.auth.me({ sessionToken: f.old.sessionToken })).toBeNull();
        await expect(f.caller.auth.kakaoOtp({ challengeId: oldChallenge.id, code: '1111' })).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
        });
        expect(await f.users.findDetachedKakaoOwner('old-self-kakao')).toBe(f.user.id);
        expect(await f.users.isKakaoIdentityRetired('old-self-kakao')).toBe(false);
        await expect(f.caller.auth.kakaoOtp({ challengeId: otp.challengeId, code: otpCode(f) })).rejects.toBeDefined();
        f.kakaoProfile.id = 'old-self-kakao';
        const start = await f.caller.auth.kakaoStart({ mode: 'login' });
        const choice = await f.caller.auth.kakaoExchange({ code: 'code', state: start.state });
        if (choice.status !== 'account_recovery') throw new Error('Expected same-owner recovery.');
        const back = await f.caller.auth.kakaoResolveAccount({
            oauthSessionId: choice.oauthSessionId,
            action: 'link_existing',
        });
        if (back.status !== 'otp') throw new Error('Expected OTP.');
        await f.caller.auth.kakaoOtp({ challengeId: back.challengeId, code: otpCode(f) });
        expect((await f.users.findById(f.user.id))?.oauthId).toBe('old-self-kakao');
        await expect(
            f.users.createUser({
                username: 'claim-other',
                password: 'secretpass',
                oauth: { type: 'KAKAO', id: 'new-self-kakao', email: 'other@example.test', info: {} },
            })
        ).rejects.toThrow();
    });

    it('accepts the old password for a different email, keeps retries possible and verifies new talk ownership', async () => {
        const f = await prepare({ differentEmail: true });
        if (f.choice.status !== 'join') throw new Error('Expected no email match.');
        await expect(
            f.caller.auth.kakaoLinkWithPassword({
                oauthSessionId: f.choice.oauthSessionId,
                username: f.user.username,
                credential: f.sealPassword('wrongpass'),
            })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        const otp = await f.caller.auth.kakaoLinkWithPassword({
            oauthSessionId: f.choice.oauthSessionId,
            username: f.user.username,
            credential: f.sealPassword('originalpass'),
        });
        if (otp.status !== 'otp') throw new Error('Expected OTP.');
        expect((await f.users.findById(f.user.id))?.email).toBe('owner@example.test');
        await f.caller.auth.kakaoOtp({ challengeId: otp.challengeId, code: otpCode(f) });
        expect(await f.users.findById(f.user.id)).toMatchObject({
            oauthId: 'new-self-kakao',
            email: 'new@example.test',
        });
    });

    it('keeps migrated passwords and old identities intact until the final OTP commit', async () => {
        const f = await prepare({ resetPassword: true });
        if (f.choice.status !== 'account_recovery') throw new Error('Expected recovery.');
        const setup = await f.caller.auth.kakaoResolveAccount({
            oauthSessionId: f.choice.oauthSessionId,
            action: 'link_existing',
        });
        if (setup.status !== 'password_setup') throw new Error('Expected password setup.');
        const hash = f.user.passwordHash;
        const otp = await f.caller.auth.kakaoSetPassword({
            oauthSessionId: setup.oauthSessionId,
            credential: f.sealPassword('new-valid-pass'),
        });
        if (otp.status !== 'otp') throw new Error('Expected OTP.');
        expect(f.user.passwordHash).toBe(hash);
        expect(f.user.passwordResetRequired).toBe(true);
        await f.caller.auth.kakaoOtp({ challengeId: otp.challengeId, code: otpCode(f) });
        expect(f.user.passwordResetRequired).toBe(false);
        expect(await f.users.verifyPassword(f.user, 'new-valid-pass')).toBe(true);
    });

    it('still requires approval for privileged accounts even with the password', async () => {
        const f = await prepare({ privileged: true });
        if (f.choice.status !== 'account_recovery') throw new Error('Expected recovery.');
        await expect(
            f.caller.auth.kakaoLinkWithPassword({
                oauthSessionId: f.choice.oauthSessionId,
                username: f.user.username,
                credential: f.sealPassword('originalpass'),
            })
        ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
        expect(f.user.oauthId).toBe('old-self-kakao');
    });

    it.each(['roles', 'password', 'sanction', 'identity', 'expired', 'provider'] as const)(
        'does not commit if %s changes during OTP',
        async (change) => {
            const f = await prepare();
            if (f.choice.status !== 'account_recovery') throw new Error('Expected recovery.');
            const otp = await f.caller.auth.kakaoResolveAccount({
                oauthSessionId: f.choice.oauthSessionId,
                action: 'link_existing',
            });
            if (otp.status !== 'otp') throw new Error('Expected OTP.');
            if (change === 'roles') await f.users.updateRoles(f.user.id, ['admin']);
            if (change === 'password') await f.users.updatePassword(f.user.id, 'changed-elsewhere');
            if (change === 'sanction')
                await f.users.updateSanctions(f.user.id, {
                    bannedUntil: new Date(Date.now() + 86400000).toISOString(),
                });
            if (change === 'identity') f.user.authRevision = 1;
            if (change === 'expired') {
                const challenge = await f.oauthSessions.getLoginChallengeForUser(f.user.id);
                const pending = await f.oauthSessions.getSession(challenge!.oauthSessionId!);
                pending!.createdAt = new Date(Date.now() - 301000).toISOString();
            }
            if (change === 'provider') f.kakaoProfile.id = 'another-kakao';
            await expect(
                f.caller.auth.kakaoOtp({ challengeId: otp.challengeId, code: otpCode(f) })
            ).rejects.toBeDefined();
            expect(f.user.oauthId).toBe('old-self-kakao');
            expect(await f.users.findDetachedKakaoOwner('old-self-kakao')).toBeNull();
        }
    );

    it('does not change any identity when sending the new talk challenge fails', async () => {
        const f = await prepare();
        if (f.choice.status !== 'account_recovery') throw new Error('Expected recovery.');
        vi.spyOn(f.kakaoClient, 'sendTalkMessage').mockRejectedValue(new Error('synthetic provider failure'));
        await expect(
            f.caller.auth.kakaoResolveAccount({ oauthSessionId: f.choice.oauthSessionId, action: 'link_existing' })
        ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: '카카오톡 인증 코드를 보내지 못했습니다.' });
        expect(f.user.oauthId).toBe('old-self-kakao');
        expect(await f.caller.auth.me({ sessionToken: f.old.sessionToken })).not.toBeNull();
    });

    it('checks password-based recovery over real HTTP before issuing the new challenge', async () => {
        const f = await prepare({ differentEmail: true });
        if (f.choice.status !== 'join') throw new Error('Expected join fallback.');
        const app = fastify();
        await app.register(fastifyTRPCPlugin, {
            prefix: '/gateway/api/trpc',
            trpcOptions: { router: appRouter, ...trpcJsonBodyHttpServerOptions, createContext: () => f.context },
        });
        try {
            const address = await app.listen({ host: '127.0.0.1', port: 0 });
            const post = (name: string, input: object) =>
                fetch(`${address}/gateway/api/trpc/${name}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(input),
                });
            expect(
                (
                    await post('auth.kakaoLinkWithPassword', {
                        oauthSessionId: f.choice.oauthSessionId,
                        username: f.user.username,
                        credential: f.sealPassword('incorrect'),
                    })
                ).status
            ).toBe(401);
            expect(
                (
                    await post('auth.kakaoLinkWithPassword', {
                        oauthSessionId: 'invalid',
                        username: f.user.username,
                        credential: f.sealPassword('originalpass'),
                    })
                ).status
            ).toBe(400);
            const response = await post('auth.kakaoLinkWithPassword', {
                oauthSessionId: f.choice.oauthSessionId,
                username: f.user.username,
                credential: f.sealPassword('originalpass'),
            });
            expect(response.status).toBe(200);
            const data = (await response.json()) as { result: { data: { status: string; challengeId: string } } };
            expect(data.result.data.status).toBe('otp');
            expect(f.user.oauthId).toBe('old-self-kakao');
            expect(
                (await post('auth.kakaoOtp', { challengeId: data.result.data.challengeId, code: otpCode(f) })).status
            ).toBe(200);
            expect(f.user.oauthId).toBe('new-self-kakao');
        } finally {
            await app.close();
        }
    });
});
