import { describe, expect, it } from 'vitest';

import { InMemoryGatewaySessionService } from '../src/auth/inMemorySessionService.js';
import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';
import { InMemoryOAuthSessionStore } from '../src/auth/oauthSessionStore.js';
import { createGatewayApiContext } from '../src/context.js';
import { appRouter } from '../src/router.js';

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
    const caller = appRouter.createCaller(
        createGatewayApiContext({
            users,
            sessions,
            flushPublisher,
            gameTokenSecret: 'test-secret',
            gameSessionTtlSeconds: 600,
            kakaoClient,
            oauthSessions,
            publicBaseUrl: 'http://localhost',
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
