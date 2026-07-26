import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import { InMemoryGatewaySessionService } from '../src/auth/inMemorySessionService.js';
import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';
import { InMemoryOAuthSessionStore } from '../src/auth/oauthSessionStore.js';
import type { KakaoOAuthClient } from '../src/auth/kakaoClient.js';
import { createGatewayApiContext } from '../src/context.js';
import { InMemoryProfileStatusService } from '../src/lobby/profileStatusService.js';
import { appRouter } from '../src/router.js';
import type { GatewayPrismaClient } from '@sammo-ts/infra';
import { decryptGameSessionToken } from '@sammo-ts/common/auth/gameToken';

const buildCaller = (options: { userIconDir?: string } = {}) => {
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
        buildAuthUrl: () => '',
        exchangeCode: async () => {
            throw new Error('not used');
        },
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
    const profiles = {
        listProfiles: async () => [],
        getProfile: async () => null,
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
    const profileStatus = new InMemoryProfileStatusService();
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
            profiles,
            orchestrator,
            profileStatus,
            requestHeaders: {},
            prisma: {
                appUser: {
                    findFirst: async () => null,
                },
            } as unknown as GatewayPrismaClient,
        })
    );
    return { caller, oauthSessions, users, sessions };
};

describe('gateway auth flow', () => {
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
        const { caller, oauthSessions } = buildCaller();
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
            password: 'secretpass',
            displayName: 'Tester',
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
        const { caller, users, sessions } = buildCaller();
        const user = await users.createUser({
            username: 'self-service',
            password: 'current-password',
        });
        const session = await sessions.createSession(user);

        await expect(
            caller.account.changePassword({
                sessionToken: session.sessionToken,
                currentPassword: 'wrong-password',
                newPassword: 'next-password',
            })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

        await caller.account.changePassword({
            sessionToken: session.sessionToken,
            currentPassword: 'current-password',
            newPassword: 'next-password',
        });

        const refreshed = await users.findById(user.id);
        expect(refreshed && (await users.verifyPassword(refreshed, 'next-password'))).toBe(true);
    });

    it('revokes the session and schedules deletion after 30 days', async () => {
        const { caller, users, sessions } = buildCaller();
        const user = await users.createUser({
            username: 'delete-self',
            password: 'current-password',
        });
        const session = await sessions.createSession(user);

        const result = await caller.account.scheduleDeletion({
            sessionToken: session.sessionToken,
            currentPassword: 'current-password',
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
