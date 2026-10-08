import { randomUUID } from 'node:crypto';
import fastify, { type FastifyRequest } from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { trpcJsonBodyHttpServerOptions } from '@sammo-ts/common';
import { appRouter } from '../src/router.js';
import { createGatewayApiContext } from '../src/context.js';
import { AuthAttemptBudget, RedisAuthCounterStore } from '../src/auth/attemptBudget.js';
import { createPasswordEnvelopeService } from '../src/auth/passwordEnvelope.js';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RedisGatewaySessionService } from '../src/auth/redisSessionService.js';
import { InMemoryGatewaySessionService } from '../src/auth/inMemorySessionService.js';
import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';

const redisUrl = process.env.GATEWAY_SESSION_REDIS_TEST_URL;
const limit = 256;
const user = async () => {
    const users = createInMemoryUserRepository();
    return users.createUser({ username: `session-${randomUUID()}`, password: 'synthetic-test-password' });
};

describe.skipIf(!redisUrl)('game session lifecycle over real Redis', () => {
    const client = createClient({ url: redisUrl });
    const prefix = `game-session-security-test:${randomUUID()}`;
    const store = new RedisGatewaySessionService(client, {
        keyPrefix: prefix,
        sessionTtlSeconds: 600,
        gameSessionTtlSeconds: 300,
    });
    beforeAll(async () => {
        await client.connect();
    });
    afterAll(async () => {
        for await (const keys of client.scanIterator({ MATCH: `${prefix}:*`, COUNT: 100 })) {
            if (keys.length) await client.del(keys);
        }
        await client.quit();
    });
    const keys = (token: string) => ({
        parent: `${prefix}:session:${token}`,
        games: `${prefix}:session-games:${token}`,
    });

    const httpFixture = async () => {
        const users = createInMemoryUserRepository();
        const first = await users.createUser({ username: `first-${randomUUID()}`, password: 'synthetic-password' });
        const second = await users.createUser({ username: `second-${randomUUID()}`, password: 'synthetic-password' });
        const parents = await Promise.all([
            store.createSession(first),
            store.createSession(first),
            store.createSession(second),
        ]);
        const profiles = { getProfile: vi.fn(async () => null) };
        const authBudget = new AuthAttemptBudget(
            new RedisAuthCounterStore(client),
            `${prefix}:${randomUUID()}`,
            'synthetic-rate-key'
        );
        const passwordEnvelope = createPasswordEnvelopeService();
        const app = fastify({ trustProxy: false });
        await app.register(fastifyTRPCPlugin, {
            prefix: '/trpc',
            trpcOptions: {
                router: appRouter,
                ...trpcJsonBodyHttpServerOptions,
                createContext: ({ req }: { req: FastifyRequest }) =>
                    createGatewayApiContext({
                        users,
                        sessions: store,
                        passwordEnvelope,
                        authBudget,
                        requestIp: req.ip,
                        requestHeaders: req.headers,
                        flushPublisher: { publishUserFlush: async () => {} },
                        gameTokenSecret: 'synthetic-game-key',
                        gameSessionTtlSeconds: 300,
                        kakaoClient: {} as never,
                        oauthSessions: {} as never,
                        publicBaseUrl: 'http://localhost',
                        adminLocalAccountEnabled: true,
                        localRegistrationEnabled: true,
                        localAccountGraceDays: 7,
                        profiles: profiles as never,
                        orchestrator: {} as never,
                        profileStatus: {} as never,
                        prisma: {} as never,
                    }),
            },
        });
        const address = await app.listen({ host: '127.0.0.1', port: 0 });
        const post = (operation: string, input: unknown) =>
            fetch(`${address}/trpc/${operation}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(input),
            });
        const issue = (index: number) =>
            post('auth.issueGameSession', { sessionToken: parents[index]!.sessionToken, profile: 'che:default' });
        return { app, post, issue, parents, profiles };
    };

    it('limits real HTTP issuance by account across login sessions before profile/icon reads', async () => {
        const f = await httpFixture();
        try {
            for (let i = 0; i < 32; i++) expect((await f.issue(i % 2)).status).toBe(200);
            const denied = await f.issue(1);
            expect(denied.status).toBe(429);
            expect(f.profiles.getProfile).toHaveBeenCalledTimes(32);
            expect(JSON.stringify(await denied.json())).not.toContain('stack');
            expect((await f.issue(2)).status).toBe(200);
            expect(
                (await f.post('auth.issueGameSession', { sessionToken: 'unknown', profile: 'che:default' })).status
            ).toBe(401);
        } finally {
            await f.app.close();
        }
    });

    it('maps the live record cap to HTTP 429 without invalidating existing tokens', async () => {
        const f = await httpFixture();
        const parent = f.parents[0]!;
        try {
            const first = await store.createGameSession(parent.sessionToken, 'che:default');
            for (let i = 1; i < limit; i++) await store.createGameSession(parent.sessionToken, 'che:default');
            expect((await f.issue(0)).status).toBe(429);
            expect(await store.getGameSession('che:default', first!.gameToken)).toEqual(first);
            expect((await f.post('auth.logout', { sessionToken: parent.sessionToken })).status).toBe(200);
            expect((await f.issue(0)).status).toBe(401);
            expect(await client.sCard(keys(parent.sessionToken).games)).toBe(0);
        } finally {
            await f.app.close();
        }
    });

    it('preserves game records when explicitly revoking only the parent', async () => {
        const parent = await store.createSession(await user());
        const game = await store.createGameSession(parent.sessionToken, 'che:default');
        await store.revokeSession(parent.sessionToken, { revokeGames: false });
        expect(await store.getSession(parent.sessionToken)).toBeNull();
        expect(await store.getGameSession('che:default', game!.gameToken)).toEqual(game);
    });

    it('atomically admits exactly 256 live records across concurrent profile requests', async () => {
        const session = await store.createSession(await user());
        const outcomes = await Promise.allSettled(
            Array.from({ length: limit + 32 }, (_, i) =>
                store.createGameSession(session.sessionToken, i % 2 ? 'che:default' : 'hwe:default')
            )
        );
        expect(outcomes.filter((x) => x.status === 'fulfilled' && x.value)).toHaveLength(limit);
        expect(outcomes.filter((x) => x.status === 'rejected')).toHaveLength(32);
        expect(await client.sCard(keys(session.sessionToken).games)).toBe(limit);
    });

    it('removes expired membership before admitting a new game session', async () => {
        const session = await store.createSession(await user());
        const key = keys(session.sessionToken).games;
        const expiredKeys = Array.from({ length: limit }, (_, i) => `${prefix}:game-session:che:default:expired-${i}`);
        await client.sAdd(key, expiredKeys);
        expect(await store.createGameSession(session.sessionToken, 'che:default')).not.toBeNull();
        expect(await client.sCard(key)).toBe(1);
    });

    it('does not revive a parent revoked after its snapshot was read', async () => {
        const session = await store.createSession(await user());
        const get = vi.spyOn(store, 'getSession');
        get.mockImplementationOnce(async () => {
            await store.revokeSession(session.sessionToken);
            return session;
        });
        try {
            expect(await store.createGameSession(session.sessionToken, 'che:default')).toBeNull();
            expect(await client.exists(keys(session.sessionToken).games)).toBe(0);
        } finally {
            get.mockRestore();
        }
    });

    it('preserves independent game TTL without resetting the index to a fresh parent TTL', async () => {
        const session = await store.createSession(await user());
        const { parent, games } = keys(session.sessionToken);
        await client.pExpire(parent, 1000);
        const game = await store.createGameSession(session.sessionToken, 'che:default');
        expect(game).not.toBeNull();
        expect(await client.pTTL(games)).toBeGreaterThan(295_000);
        expect(await client.pTTL(games)).toBeLessThanOrEqual(300_000);
    });

    it('revokes existing oversized indexes in bounded batches while preserving other parents', async () => {
        const session = await store.createSession(await user());
        const other = await store.createSession(await user());
        const gameKeys = Array.from({ length: limit + 9 }, (_, i) => `${prefix}:game-session:che:default:legacy-${i}`);
        const transaction = client.multi();
        for (const key of gameKeys) transaction.set(key, '{}', { EX: 300 });
        transaction.sAdd(keys(session.sessionToken).games, gameKeys);
        await transaction.exec();
        await expect(store.createGameSession(session.sessionToken, 'che:default')).rejects.toThrow(
            'Game session limit'
        );
        await store.revokeSession(session.sessionToken);
        expect(
            await client.exists([keys(session.sessionToken).parent, keys(session.sessionToken).games, ...gameKeys])
        ).toBe(0);
        expect(await store.getSession(other.sessionToken)).not.toBeNull();
    });
});

describe('in-memory game session lifecycle', () => {
    it('enforces the same live cap and reclaims expired records', async () => {
        const store = new InMemoryGatewaySessionService({ sessionTtlSeconds: 600, gameSessionTtlSeconds: 1 });
        const session = await store.createSession(await user());
        try {
            vi.useFakeTimers();
            for (let i = 0; i < limit; i++)
                expect(await store.createGameSession(session.sessionToken, 'che:default')).not.toBeNull();
            await expect(store.createGameSession(session.sessionToken, 'hwe:default')).rejects.toThrow(
                'Game session limit'
            );
            vi.advanceTimersByTime(1001);
            expect(await store.createGameSession(session.sessionToken, 'hwe:default')).not.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
    it('does not issue after a concurrent revoke', async () => {
        const store = new InMemoryGatewaySessionService({ sessionTtlSeconds: 600, gameSessionTtlSeconds: 300 });
        const session = await store.createSession(await user());
        const get = vi.spyOn(store, 'getSession').mockImplementationOnce(async () => {
            await store.revokeSession(session.sessionToken);
            return session;
        });
        try {
            expect(await store.createGameSession(session.sessionToken, 'che:default')).toBeNull();
        } finally {
            get.mockRestore();
        }
    });
});
