import { describe, expect, it } from 'vitest';
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
import { decryptGameSessionToken } from '@sammo-ts/common/auth/gameToken';
import { createPasswordEnvelopeService } from '../src/auth/passwordEnvelope.js';

const buildCaller = (options: { userIconDir?: string; localAccountGraceDays?: number } = {}) => {
    const users = createInMemoryUserRepository();
    const sessions = new InMemoryGatewaySessionService({
        sessionTtlSeconds: 3600,
        gameSessionTtlSeconds: 600,
    });
    const flushPublisher = {
        publishUserFlush: async () => {},
    };
    const oauthSessions = new InMemoryOAuthSessionStore();
    const kakaoClient = {
        restKey: '',
        redirectUri: '',
        oauthHost: '',
        apiHost: '',
        buildAuthUrl: (state: string) => `https://kauth.example.test/authorize?state=${state}`,
        exchangeCode: async () => ({
            accessToken: 'access-token',
            accessTokenExpiresIn: 3600,
            refreshToken: 'refresh-token',
            refreshTokenExpiresIn: 86400,
        }),
        refreshToken: async () => {
            throw new Error('not used');
        },
        signup: async () => ({ id: '1' }),
        getMe: async () => ({
            id: '1',
            kakaoAccount: {
                hasEmail: true,
                email: 'tester@example.com',
                isEmailValid: true,
                isEmailVerified: true,
            },
        }),
        sendTalkMessage: async () => {},
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
        getProfile: async (profileName: string) => profileRows.find((profile) => profile.profileName === profileName) ?? null,
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
    const passwordEnvelope = createPasswordEnvelopeService();
    const requestHeaders: Record<string, string> = {};
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
        expect(login.user.username).toBe('local-user');
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
        const { caller, users, sealPassword, setSessionHeader } = buildCaller();
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

        expect(verified.status).toBe('verified');
        if (verified.status !== 'verified') {
            throw new Error('Expected verified result.');
        }
        expect(verified.user.kakaoVerified).toBe(true);
        const stored = await users.findByUsername('verify-user');
        expect(stored).toMatchObject({
            oauthType: 'KAKAO',
            oauthId: '1',
            email: 'tester@example.com',
        });
        expect(stored?.kakaoVerifiedAt).toBeTruthy();
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
        const { caller, oauthSessions, sealPassword } = buildCaller();
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

        expect(register.user.username).toBe('tester');
        expect(register.sessionToken).toBeTruthy();

        const issued = await caller.auth.issueGameSession({
            sessionToken: register.sessionToken,
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
            const { caller, users, sessions } = buildCaller({ userIconDir: iconDir });
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

            expect(result.iconUrl).toMatch(/^http:\/\/localhost\/user-icons\/[a-f0-9]{16}\.png$/);
            expect(updated?.imageServer).toBe(1);
            expect(await fs.stat(path.join(iconDir, updated?.picture ?? 'missing'))).toBeTruthy();
            await expect(caller.account.deleteIcon({ sessionToken: session.sessionToken })).rejects.toMatchObject({
                code: 'TOO_MANY_REQUESTS',
            });
        } finally {
            await fs.rm(iconDir, { recursive: true, force: true });
        }
    });
});
