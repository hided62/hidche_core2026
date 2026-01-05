import { describe, expect, it } from 'vitest';

import { InMemoryGatewaySessionService } from '../src/auth/inMemorySessionService.js';
import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';
import { InMemoryOAuthSessionStore } from '../src/auth/oauthSessionStore.js';
import type { KakaoOAuthClient } from '../src/auth/kakaoClient.js';
import { createGatewayApiContext } from '../src/context.js';
import { InMemoryProfileStatusService } from '../src/lobby/profileStatusService.js';
import { appRouter } from '../src/router.js';
import type { GatewayPrismaClient } from '@sammo-ts/infra';

const buildCaller = () => {
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
        updateStatus: async () => null,
        updateBuildStatus: async () => null,
        updateMeta: async () => null,
        listReservedToStart: async () => [],
        findQueuedBuild: async () => null,
        updateLastError: async () => {},
        updateWorkspaceUsage: async () => {},
        clearWorkspaceUsage: async () => {},
    };
    const orchestrator = {
        start: () => {},
        stop: async () => {},
        reconcileNow: async () => {},
        runScheduleNow: async () => {},
        runBuildQueueNow: async () => {},
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
            profiles,
            orchestrator,
            profileStatus,
            requestHeaders: {},
            prisma: {} as unknown as GatewayPrismaClient,
        })
    );
    return { caller, oauthSessions };
};

describe('gateway auth flow', () => {
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
});
