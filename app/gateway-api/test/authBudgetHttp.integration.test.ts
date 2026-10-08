import { constants, publicEncrypt, randomUUID } from 'node:crypto';
import fastify, { type FastifyRequest } from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { trpcJsonBodyHttpServerOptions } from '@sammo-ts/common';
import { createGatewayApiContext } from '../src/context.js';
import { appRouter } from '../src/router.js';
import { AuthAttemptBudget, RedisAuthCounterStore } from '../src/auth/attemptBudget.js';
import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';
import { InMemoryGatewaySessionService } from '../src/auth/inMemorySessionService.js';
import { createPasswordEnvelopeService } from '../src/auth/passwordEnvelope.js';

const redisUrl = process.env.GATEWAY_AUTH_REDIS_TEST_URL;

describe.skipIf(!redisUrl)('authentication budgets over real HTTP and Redis', () => {
    const client = createClient({ url: redisUrl });
    const prefix = `auth-budget-http-test:${randomUUID()}`;
    const envelope = createPasswordEnvelopeService();
    beforeAll(async () => {
        await client.connect();
    });
    afterAll(async () => {
        const keys: string[] = [];
        for await (const page of client.scanIterator({ MATCH: `${prefix}:*`, COUNT: 100 })) keys.push(...page);
        if (keys.length) await client.del(keys);
        await client.quit();
    });
    const credential = (password: string) => {
        const key = envelope.getPublicKey();
        return {
            keyId: key.keyId,
            ciphertext: publicEncrypt(
                { key: key.publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
                Buffer.from(password)
            ).toString('base64'),
        };
    };
    const fixture = async (available = true) => {
        const users = createInMemoryUserRepository();
        await users.createUser({ username: 'target-user', password: 'correct-password' });
        await users.createUser({ username: 'other-user', password: 'correct-password' });
        const requestIps = new Set<string>();
        const peer = (request: FastifyRequest): string => {
            requestIps.add(request.ip);
            return request.ip;
        };
        const verify = vi.spyOn(users, 'verifyPassword');
        const open = vi.fn(envelope.open);
        const sessions = new InMemoryGatewaySessionService({ sessionTtlSeconds: 600, gameSessionTtlSeconds: 600 });
        const authBudget = new AuthAttemptBudget(
            new RedisAuthCounterStore(available ? client : client.duplicate()),
            `${prefix}:${randomUUID()}`,
            'synthetic-budget-key'
        );
        const app = fastify({ trustProxy: false });
        await app.register(fastifyTRPCPlugin, {
            prefix: '/trpc',
            trpcOptions: {
                router: appRouter,
                ...trpcJsonBodyHttpServerOptions,
                createContext: ({ req }: { req: FastifyRequest }) =>
                    createGatewayApiContext({
                        users,
                        sessions,
                        passwordEnvelope: { ...envelope, open },
                        authBudget,
                        requestIp: peer(req),
                        requestHeaders: req.headers,
                        flushPublisher: { publishUserFlush: async () => {} },
                        gameTokenSecret: 'synthetic-game-key',
                        gameSessionTtlSeconds: 600,
                        kakaoClient: {} as never,
                        oauthSessions: {} as never,
                        publicBaseUrl: 'http://localhost',
                        adminLocalAccountEnabled: true,
                        localRegistrationEnabled: true,
                        localAccountGraceDays: 7,
                        profiles: {} as never,
                        orchestrator: {} as never,
                        profileStatus: {} as never,
                        prisma: {} as never,
                    }),
            },
        });
        const address = await app.listen({ host: '127.0.0.1', port: 0 });
        const post = (operation: string, input: unknown, headers: Record<string, string> = {}) =>
            fetch(`${address}/trpc/${operation}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...headers },
                body: JSON.stringify(input),
            });
        return { app, address, post, users, sessions, verify, open, requestIps };
    };

    it('blocks an eleventh normalized account attempt before RSA/Argon2 despite spoofed forwarding headers', async () => {
        const f = await fixture();
        try {
            for (let i = 0; i < 10; i++) {
                const response = await f.post(
                    'auth.login',
                    { username: i % 2 ? ' TARGET-USER ' : 'target-user', credential: credential('wrong-password') },
                    { 'x-forwarded-for': `198.51.100.${i + 1}` }
                );
                expect(response.status).toBe(401);
            }
            expect(f.requestIps.size).toBe(1);
            expect(f.requestIps.has('127.0.0.1')).toBe(true);
            expect(f.verify).toHaveBeenCalledTimes(10);
            expect(f.open).toHaveBeenCalledTimes(10);
            const denied = await f.post(
                'auth.login',
                { username: 'target-user', credential: credential('correct-password') },
                { 'x-forwarded-for': '203.0.113.99' }
            );
            expect(denied.status).toBe(429);
            expect(JSON.stringify(await denied.json())).not.toContain('stack');
            expect(f.verify).toHaveBeenCalledTimes(10);
            expect(f.open).toHaveBeenCalledTimes(10);
            expect(
                (await f.post('auth.login', { username: 'other-user', credential: credential('correct-password') }))
                    .status
            ).toBe(200);
        } finally {
            await f.app.close();
        }
    });

    it('charges each operation in a tRPC batch instead of granting one budget per HTTP request', async () => {
        const f = await fixture();
        try {
            const statuses: number[] = [];
            for (let round = 0; round < 4; round++) {
                const input = Object.fromEntries(
                    Array.from({ length: 3 }, (_value, i) => [
                        String(i),
                        { username: 'target-user', credential: credential('wrong-password') },
                    ])
                );
                const response = await f.post('auth.login,auth.login,auth.login?batch=1', input);
                const body = (await response.json()) as Array<{ error: { data: { httpStatus: number } } }>;
                statuses.push(...body.map((entry) => entry.error.data.httpStatus));
            }
            expect(statuses.filter((status) => status === 401)).toHaveLength(10);
            expect(statuses.filter((status) => status === 429)).toHaveLength(2);
            expect(f.verify).toHaveBeenCalledTimes(10);
        } finally {
            await f.app.close();
        }
    });

    it('shares the password/deletion subject across sessions of the same authenticated actor', async () => {
        const f = await fixture();
        const user = await f.users.findByUsername('target-user');
        try {
            for (let i = 0; i < 10; i++) {
                const session = await f.sessions.createSession(user!);
                const response = await f.post(i % 2 ? 'account.changePassword' : 'account.scheduleDeletion', {
                    sessionToken: session.sessionToken,
                    currentCredential: credential('wrong-password'),
                    newCredential: credential('new-password'),
                });
                expect(response.status).toBe(401);
            }
            const session = await f.sessions.createSession(user!);
            expect(
                (
                    await f.post('account.scheduleDeletion', {
                        sessionToken: session.sessionToken,
                        currentCredential: credential('correct-password'),
                    })
                ).status
            ).toBe(429);
            expect(f.verify).toHaveBeenCalledTimes(10);
            expect(f.open).toHaveBeenCalledTimes(10);
            expect((await f.users.findById(user!.id))?.deleteAfter).toBeUndefined();
        } finally {
            await f.app.close();
        }
    });

    it('fails closed on unavailable protection while keeping logout independent of its counters', async () => {
        const f = await fixture(false);
        try {
            expect(
                (await f.post('auth.login', { username: 'target-user', credential: credential('correct-password') }))
                    .status
            ).toBe(503);
            expect(f.open).not.toHaveBeenCalled();
            expect(f.verify).not.toHaveBeenCalled();
            const user = await f.users.findByUsername('target-user');
            const session = await f.sessions.createSession(user!);
            expect((await f.post('auth.logout', { sessionToken: session.sessionToken })).status).toBe(200);
            expect(await f.sessions.getSession(session.sessionToken)).toBeNull();
            expect(
                (await f.post('auth.login', { username: 123, credential: credential('correct-password') })).status
            ).toBe(503);
            const malformed = await fetch(`${f.address}/trpc/auth.login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{',
            });
            expect(malformed.status).toBe(400);
        } finally {
            await f.app.close();
        }
    });

    it('bounds parallel credential work and admits a subsequent request after all failures settle', async () => {
        const f = await fixture();
        let release!: () => void;
        const waiting = new Promise<void>((resolve) => {
            release = resolve;
        });
        f.verify.mockImplementation(async () => {
            await waiting;
            return false;
        });
        const input = { username: 'target-user', credential: credential('wrong-password') };
        const pending = Array.from({ length: 4 }, () => f.post('auth.login', input));
        try {
            await vi.waitFor(() => expect(f.verify).toHaveBeenCalledTimes(4));
            expect((await f.post('auth.login', input)).status).toBe(429);
            expect(f.open).toHaveBeenCalledTimes(4);
            release();
            expect((await Promise.all(pending)).map((r) => r.status)).toEqual([401, 401, 401, 401]);
            f.verify.mockRestore();
            expect(
                (await f.post('auth.login', { username: 'target-user', credential: credential('correct-password') }))
                    .status
            ).toBe(200);
        } finally {
            release();
            await Promise.allSettled(pending);
            await f.app.close();
        }
    });
});
