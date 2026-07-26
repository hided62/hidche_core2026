import { describe, expect, it } from 'vitest';

import type { GatewayPrismaClient } from '@sammo-ts/infra';

import { InMemoryGatewaySessionService } from '../src/auth/inMemorySessionService.js';
import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';
import type { GatewayOperationCreateInput, GatewayProfileRepository } from '../src/orchestrator/profileRepository.js';
import { createGatewayApiContext } from '../src/context.js';
import { InMemoryProfileStatusService } from '../src/lobby/profileStatusService.js';
import { appRouter } from '../src/router.js';
import { createPasswordEnvelopeService } from '../src/auth/passwordEnvelope.js';

const buildCaller = async (createOperation: GatewayProfileRepository['createOperation']) => {
    const users = createInMemoryUserRepository();
    const admin = await users.createUser({
        username: 'admin',
        password: 'secretpass',
        displayName: 'Admin',
    });
    await users.updateRoles(admin.id, ['superuser']);
    const sessions = new InMemoryGatewaySessionService({
        sessionTtlSeconds: 600,
        gameSessionTtlSeconds: 600,
    });
    const session = await sessions.createSession({ ...admin, roles: ['superuser'] });
    const createdInputs: GatewayOperationCreateInput[] = [];
    const profile = {
        profileName: 'che:2',
        profile: 'che',
        scenario: '2',
        apiPort: 15003,
        status: 'STOPPED' as const,
        buildStatus: 'SUCCEEDED' as const,
        meta: {},
        createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z',
    };
    const profiles: GatewayProfileRepository = {
        listProfiles: async () => [profile],
        getProfile: async () => profile,
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
        createOperation: async (input) => {
            createdInputs.push(input);
            return createOperation(input);
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
    const caller = appRouter.createCaller(
        createGatewayApiContext({
            users,
            sessions,
            flushPublisher: { publishUserFlush: async () => {} },
            gameTokenSecret: 'test-secret',
            gameSessionTtlSeconds: 600,
            kakaoClient: {} as never,
            oauthSessions: {} as never,
            publicBaseUrl: 'http://localhost',
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
            requestHeaders: { 'x-session-token': session.sessionToken },
            prisma: {
                appUser: {
                    findFirst: async () => ({ id: admin.id }),
                },
            } as unknown as GatewayPrismaClient,
        })
    );
    return { caller, createdInputs };
};

describe('admin operation API', () => {
    it('queues a start operation with the authenticated requester', async () => {
        const operation = {
            id: '11111111-1111-4111-8111-111111111111',
            profileName: 'che:2',
            type: 'START' as const,
            status: 'QUEUED' as const,
            payload: {},
            requestedBy: 'admin-id',
            createdAt: '2026-07-25T00:00:00.000Z',
            updatedAt: '2026-07-25T00:00:00.000Z',
        };
        const harness = await buildCaller(async () => operation);

        const result = await harness.caller.admin.operations.requestRuntime({
            profileName: 'che:2',
            action: 'START',
            reason: 'maintenance complete',
        });

        expect(result.type).toBe('START');
        expect(harness.createdInputs[0]).toMatchObject({
            profileName: 'che:2',
            type: 'START',
            reason: 'maintenance complete',
        });
    });

    it('reports an active-operation uniqueness conflict', async () => {
        const harness = await buildCaller(async () => {
            throw { code: 'P2002' };
        });

        await expect(
            harness.caller.admin.operations.requestRuntime({
                profileName: 'che:2',
                action: 'STOP',
            })
        ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
});
