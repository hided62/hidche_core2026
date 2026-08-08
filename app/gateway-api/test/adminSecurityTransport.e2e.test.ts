import fastify, { type FastifyRequest } from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { GatewayPrismaClient } from '@sammo-ts/infra';

import { InMemoryGatewaySessionService } from '../src/auth/inMemorySessionService.js';
import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';
import { createPasswordEnvelopeService } from '../src/auth/passwordEnvelope.js';
import { createGatewayApiContext } from '../src/context.js';
import { InMemoryProfileStatusService } from '../src/lobby/profileStatusService.js';
import type { GatewayProfileRepository } from '../src/orchestrator/profileRepository.js';
import { appRouter } from '../src/router.js';

const profile = {
    profileName: 'che:default',
    profile: 'che',
    scenario: 'default',
    apiPort: 15003,
    status: 'RUNNING' as const,
    buildStatus: 'SUCCEEDED' as const,
    meta: {},
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
};

const profiles: GatewayProfileRepository = {
    listProfiles: async () => [profile],
    getProfile: async (profileName) => (profileName === profile.profileName ? profile : null),
    upsertProfile: async () => profile,
    updateScenario: async () => profile,
    updateStatus: async () => profile,
    updateBuildStatus: async () => profile,
    updateMeta: async () => profile,
    listReservedToStart: async () => [],
    findQueuedBuild: async () => null,
    updateLastError: async () => {},
    updateWorkspaceUsage: async () => {},
    clearWorkspaceUsage: async () => {},
    listOperations: async () => [],
    getOperation: async () => null,
    createOperation: async () => {
        throw new Error('not used');
    },
    claimNextOperation: async () => null,
    completeOperation: async () => {
        throw new Error('not used');
    },
    requeueOperation: async () => {
        throw new Error('not used');
    },
    cancelOperation: async () => false,
    retryOperation: async () => null,
};

const openApps = new Set<ReturnType<typeof fastify>>();

afterEach(async () => {
    await Promise.allSettled(Array.from(openApps, (app) => app.close()));
    openApps.clear();
});

const createHarness = async (adminRoles = ['user', 'admin.users.manage', 'admin.survey.open:che:default']) => {
    const users = createInMemoryUserRepository();
    const admin = await users.createUser({
        username: 'scoped-admin',
        password: 'secretpass',
        displayName: 'Scoped Admin',
    });
    await users.updateRoles(admin.id, adminRoles);
    const target = await users.createUser({
        username: 'target-user',
        password: 'secretpass',
        displayName: 'Target',
    });
    const sessions = new InMemoryGatewaySessionService({
        sessionTtlSeconds: 600,
        gameSessionTtlSeconds: 600,
    });
    const adminSession = await sessions.createSession({ ...admin, roles: adminRoles });
    const targetSession = await sessions.createSession(target);
    const flushes: Array<{ userId: string; reason?: string }> = [];
    const app = fastify({ logger: false });
    await app.register(fastifyTRPCPlugin, {
        prefix: '/trpc',
        trpcOptions: {
            router: appRouter,
            createContext: ({ req }: { req: FastifyRequest }) =>
                createGatewayApiContext({
                    users,
                    sessions,
                    flushPublisher: {
                        publishUserFlush: async (userId, reason) => {
                            flushes.push({ userId, reason });
                        },
                    },
                    gameTokenSecret: 'transport-e2e-secret',
                    gameSessionTtlSeconds: 600,
                    kakaoClient: {} as never,
                    oauthSessions: {} as never,
                    publicBaseUrl: 'http://127.0.0.1',
                    adminLocalAccountEnabled: false,
                    localRegistrationEnabled: true,
                    localAccountGraceDays: 7,
                    passwordEnvelope: createPasswordEnvelopeService(),
                    profiles,
                    orchestrator: {
                        start: () => {},
                        stop: async () => {},
                        reconcileNow: async () => {},
                        runScheduleNow: async () => {},
                        runBuildQueueNow: async () => {},
                        runOperationsNow: async () => {},
                        cleanupStaleWorkspaces: async () => ({ removed: [], skipped: [] }),
                        listRuntimeStates: async () => [],
                    },
                    profileStatus: new InMemoryProfileStatusService(),
                    requestHeaders: req.headers,
                    prisma: {
                        appUser: {
                            findFirst: async () => ({ id: 'bootstrap-user' }),
                        },
                    } as unknown as GatewayPrismaClient,
                }),
        },
    });
    const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
    openApps.add(app);
    return {
        app,
        baseUrl,
        users,
        admin,
        target,
        adminSessionToken: adminSession.sessionToken,
        targetSessionToken: targetSession.sessionToken,
        flushes,
    };
};

const postTrpc = async (
    baseUrl: string,
    procedure: string,
    input: unknown,
    sessionToken?: string
): Promise<{ response: Response; body: unknown }> => {
    const response = await fetch(`${baseUrl}/trpc/${procedure}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(sessionToken ? { 'x-session-token': sessionToken } : {}),
        },
        body: JSON.stringify(input),
    });
    return {
        response,
        body: (await response.json()) as unknown,
    };
};

describe('admin security over HTTP transport', () => {
    it('does not expose the removed public user-flush mutation', async () => {
        const harness = await createHarness();

        const rejected = await postTrpc(harness.baseUrl, 'auth.flushUser', {
            userId: harness.target.id,
            reason: 'unauthenticated-flush-attempt',
        });

        expect(rejected.response.status).toBe(404);
        expect(rejected.body).toMatchObject({
            error: {
                data: {
                    code: 'NOT_FOUND',
                },
            },
        });
        expect(harness.flushes).toEqual([]);
    });

    it('accepts an equal scoped role and rejects wildcard escalation without mutating roles', async () => {
        const harness = await createHarness();

        const allowed = await postTrpc(
            harness.baseUrl,
            'admin.users.updateRoles',
            {
                userId: harness.target.id,
                roles: ['admin.survey.open:che:default'],
                mode: 'grant',
                reason: 'HTTP 권한 부여 테스트',
            },
            harness.adminSessionToken
        );
        if (allowed.response.status !== 200) {
            throw new Error(`allowed role request failed: ${JSON.stringify(allowed.body)}`);
        }
        expect(allowed.body).toMatchObject({
            result: {
                data: {
                    roles: ['user', 'admin.survey.open:che:default'],
                },
            },
        });

        const rejected = await postTrpc(
            harness.baseUrl,
            'admin.users.updateRoles',
            {
                userId: harness.target.id,
                roles: ['admin.survey.open:*'],
                mode: 'grant',
                reason: 'HTTP 권한 상승 거부 테스트',
            },
            harness.adminSessionToken
        );
        expect(rejected.response.status).toBe(403);
        expect(rejected.body).toMatchObject({
            error: {
                data: {
                    code: 'FORBIDDEN',
                },
            },
        });
        expect((await harness.users.findById(harness.target.id))?.roles).toEqual([
            'user',
            'admin.survey.open:che:default',
        ]);
    });

    it('rejects an unauthenticated role change at the HTTP header boundary', async () => {
        const harness = await createHarness();

        const rejected = await postTrpc(harness.baseUrl, 'admin.users.updateRoles', {
            userId: harness.target.id,
            roles: ['admin.survey.open:che:default'],
            mode: 'grant',
            reason: '미인증 권한 변경 거부 테스트',
        });

        expect(rejected.response.status).toBe(401);
        expect(rejected.body).toMatchObject({
            error: {
                data: {
                    code: 'UNAUTHORIZED',
                },
            },
        });
        expect((await harness.users.findById(harness.target.id))?.roles).toEqual(['user']);
    });

    it('rejects an unauthenticated special-access grant at the HTTP header boundary', async () => {
        const harness = await createHarness();

        const rejected = await postTrpc(harness.baseUrl, 'admin.users.grantSpecialAccess', {
            userId: harness.target.id,
            kind: 'TESTER',
            profiles: ['che'],
            allowsGeneralCreation: true,
            expiresAt: null,
            reason: '미인증 특수 접근 부여 거부 테스트',
        });

        expect(rejected.response.status).toBe(401);
        expect(rejected.body).toMatchObject({
            error: {
                data: {
                    code: 'UNAUTHORIZED',
                },
            },
        });
        expect(await harness.users.listSpecialAccessGrants(harness.target.id)).toEqual([]);
    });

    it('rejects self-escalation and set-mode removal outside a scoped administrator role', async () => {
        const harness = await createHarness();

        const selfEscalation = await postTrpc(
            harness.baseUrl,
            'admin.users.updateRoles',
            {
                userId: harness.admin.id,
                roles: ['admin.survey.open:*'],
                mode: 'grant',
                reason: '자기 권한 상승 거부 테스트',
            },
            harness.adminSessionToken
        );
        expect(selfEscalation.response.status).toBe(403);
        expect((await harness.users.findByUsername('scoped-admin'))?.roles).toEqual([
            'user',
            'admin.users.manage',
            'admin.survey.open:che:default',
        ]);

        await harness.users.updateRoles(harness.target.id, ['user', 'admin.survey.open:*']);
        const outOfScopeRemoval = await postTrpc(
            harness.baseUrl,
            'admin.users.updateRoles',
            {
                userId: harness.target.id,
                roles: ['user'],
                mode: 'set',
                reason: '범위 밖 권한 제거 거부 테스트',
            },
            harness.adminSessionToken
        );
        expect(outOfScopeRemoval.response.status).toBe(403);
        expect((await harness.users.findById(harness.target.id))?.roles).toEqual(['user', 'admin.survey.open:*']);
    });

    it('allows a superuser to grant a root role over HTTP', async () => {
        const harness = await createHarness(['user', 'superuser']);

        const granted = await postTrpc(
            harness.baseUrl,
            'admin.users.updateRoles',
            {
                userId: harness.target.id,
                roles: ['superuser'],
                mode: 'grant',
                reason: '최고 관리자 권한 부여 테스트',
            },
            harness.adminSessionToken
        );

        expect(granted.response.status).toBe(200);
        expect((await harness.users.findById(harness.target.id))?.roles).toEqual(['user', 'superuser']);
    });

    it('blocks game-session issuance after an HTTP sanction update while retaining the gateway session', async () => {
        const harness = await createHarness();

        const updated = await postTrpc(
            harness.baseUrl,
            'admin.users.updateSanctions',
            {
                userId: harness.target.id,
                patch: {
                    suspendedUntil: '2099-01-01T00:00:00.000Z',
                },
                reason: 'HTTP 제재 적용 테스트',
            },
            harness.adminSessionToken
        );
        if (updated.response.status !== 200) {
            throw new Error(`sanction request failed: ${JSON.stringify(updated.body)}`);
        }
        expect(harness.flushes).toEqual([
            {
                userId: harness.target.id,
                reason: 'admin-sanctions-updated',
            },
        ]);

        const blocked = await postTrpc(harness.baseUrl, 'auth.issueGameSession', {
            sessionToken: harness.targetSessionToken,
            profile: profile.profileName,
        });
        expect(blocked.response.status).toBe(403);
        expect(blocked.body).toMatchObject({
            error: {
                data: {
                    code: 'FORBIDDEN',
                },
            },
        });
    });
});
