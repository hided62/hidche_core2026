import { describe, expect, it } from 'vitest';

import { InMemoryGatewaySessionService } from '../src/auth/inMemorySessionService.js';
import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';
import { createGatewayApiContext } from '../src/context.js';
import { appRouter } from '../src/router.js';

const buildCaller = () => {
    const users = createInMemoryUserRepository();
    const sessions = new InMemoryGatewaySessionService({
        sessionTtlSeconds: 3600,
        gameSessionTtlSeconds: 600,
    });
    return appRouter.createCaller(createGatewayApiContext({ users, sessions }));
};

describe('gateway auth flow', () => {
    it('registers and issues a game session', async () => {
        const caller = buildCaller();
        const register = await caller.auth.register({
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
