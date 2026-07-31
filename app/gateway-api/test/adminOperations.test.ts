import { describe, expect, it } from 'vitest';

import type { GatewayPrismaClient } from '@sammo-ts/infra';

import { InMemoryGatewaySessionService } from '../src/auth/inMemorySessionService.js';
import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';
import type {
    GatewayOperationCreateInput,
    GatewayProfileRecord,
    GatewayProfileRepository,
} from '../src/orchestrator/profileRepository.js';
import { createGatewayApiContext } from '../src/context.js';
import { InMemoryProfileStatusService } from '../src/lobby/profileStatusService.js';
import { appRouter } from '../src/router.js';
import { createPasswordEnvelopeService } from '../src/auth/passwordEnvelope.js';

const buildCaller = async (
    createOperation: GatewayProfileRepository['createOperation'],
    options: {
        adminRoles?: string[];
        firstUserIsAdmin?: boolean;
        runtimeActionCreateError?: unknown;
        initialNotice?: string;
        initialProfileStatus?: GatewayProfileRecord['status'];
    } = {}
) => {
    const users = createInMemoryUserRepository();
    const admin = await users.createUser({
        username: 'admin',
        password: 'secretpass',
        displayName: 'Admin',
    });
    const adminRoles = options.adminRoles ?? ['superuser'];
    await users.updateRoles(admin.id, adminRoles);
    const sessions = new InMemoryGatewaySessionService({
        sessionTtlSeconds: 600,
        gameSessionTtlSeconds: 600,
    });
    const session = await sessions.createSession({ ...admin, roles: adminRoles });
    const createdInputs: GatewayOperationCreateInput[] = [];
    const operationRecords = new Map<string, Awaited<ReturnType<GatewayProfileRepository['createOperation']>>>();
    const createdRuntimeActions: Array<Record<string, unknown>> = [];
    const flushes: Array<{ userId: string; reason?: string; iconRevision?: string }> = [];
    const updatedStatuses: GatewayProfileRecord['status'][] = [];
    let reconcileCount = 0;
    let storedNotice = options.initialNotice ?? '';
    const profile = {
        profileName: 'che:2',
        profile: 'che',
        scenario: '2',
        apiPort: 15003,
        status: options.initialProfileStatus ?? ('STOPPED' as const),
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
        updateStatus: async (_profileName, status) => {
            updatedStatuses.push(status);
            return { ...profile, status };
        },
        updateBuildStatus: async () => profile,
        updateMeta: async () => profile,
        listReservedToStart: async () => [],
        findQueuedBuild: async () => null,
        updateLastError: async () => {},
        updateWorkspaceUsage: async () => {},
        clearWorkspaceUsage: async () => {},
        listOperations: async () => [],
        getOperation: async (id) => operationRecords.get(id) ?? null,
        createOperation: async (input) => {
            createdInputs.push(input);
            const operation = await createOperation(input);
            operationRecords.set(operation.id, operation);
            return operation;
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
            flushPublisher: {
                publishUserFlush: async (userId, reason, metadata) => {
                    flushes.push({
                        userId,
                        reason,
                        ...(metadata?.iconRevision ? { iconRevision: metadata.iconRevision } : {}),
                    });
                },
            },
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
                reconcileNow: async () => {
                    reconcileCount += 1;
                },
                runScheduleNow: async () => {},
                runBuildQueueNow: async () => {},
                runOperationsNow: async () => {
                    for (const [id, operation] of operationRecords) {
                        operationRecords.set(id, { ...operation, status: 'SUCCEEDED' });
                    }
                },
                cleanupStaleWorkspaces: async () => ({ removed: [], skipped: [] }),
                listRuntimeStates: async () => [],
            },
            profileStatus: new InMemoryProfileStatusService(),
            requestHeaders: { 'x-session-token': session.sessionToken },
            prisma: {
                appUser: {
                    findFirst: async () => ({ id: options.firstUserIsAdmin === false ? 'bootstrap-user' : admin.id }),
                },
                gatewayRuntimeAction: {
                    create: async ({ data }: { data: Record<string, unknown> }) => {
                        if (options.runtimeActionCreateError) {
                            throw options.runtimeActionCreateError;
                        }
                        createdRuntimeActions.push(data);
                        return {
                            id: '68f1f0e4-3b95-4aeb-9925-c7e93caf1ba7',
                            ...data,
                            status: 'REQUESTED',
                            detail: null,
                            handler: null,
                            handledAt: null,
                            scheduledAt: null,
                            createdAt: new Date('2026-07-30T01:00:00.000Z'),
                            updatedAt: new Date('2026-07-30T01:00:00.000Z'),
                        };
                    },
                },
                systemSetting: {
                    findUnique: async () => ({ id: 1, notice: storedNotice }),
                    upsert: async ({ create, update }: { create: { notice: string }; update: { notice: string } }) => {
                        storedNotice = update.notice ?? create.notice;
                        return { id: 1, notice: storedNotice };
                    },
                },
            } as unknown as GatewayPrismaClient,
        })
    );
    return {
        caller,
        createdInputs,
        createdRuntimeActions,
        users,
        admin,
        flushes,
        updatedStatuses,
        getReconcileCount: () => reconcileCount,
        getStoredNotice: () => storedNotice,
        setStoredNotice: (notice: string) => {
            storedNotice = notice;
        },
    };
};

describe('gateway notice API', () => {
    const dirtyNotice =
        '<b>점검</b><br><script>globalThis.__noticeXss=1</script>' +
        '<img src=x onerror="globalThis.__noticeXss=2">' +
        '<a href="javascript:globalThis.__noticeXss=3">링크</a>';

    it('purifies notices before persistence and returns the canonical value', async () => {
        const harness = await buildCaller(async () => {
            throw new Error('not used');
        });

        const result = await harness.caller.admin.system.setNotice({ notice: dirtyNotice });

        expect(result.notice).toBe('<b>점검</b><br /><a>링크</a>');
        expect(harness.getStoredNotice()).toBe(result.notice);
        await expect(harness.caller.admin.system.getNotice()).resolves.toEqual(result);
        await expect(harness.caller.lobby.notice()).resolves.toBe(result.notice);
    });

    it('purifies pre-existing rows again on public and admin reads', async () => {
        const harness = await buildCaller(async () => {
            throw new Error('not used');
        });
        harness.setStoredNotice(dirtyNotice);

        await expect(harness.caller.lobby.notice()).resolves.toBe('<b>점검</b><br /><a>링크</a>');
        await expect(harness.caller.admin.system.getNotice()).resolves.toEqual({
            notice: '<b>점검</b><br /><a>링크</a>',
        });
        expect(harness.getStoredNotice()).toBe(dirtyNotice);
    });

    it('keeps notice writes behind the dedicated admin role', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            { adminRoles: [], firstUserIsAdmin: false }
        );

        await expect(harness.caller.admin.system.setNotice({ notice: '<b>공지</b>' })).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
    });
});

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

describe('legacy profile install API', () => {
    const install = {
        scenarioId: 1010,
        turnTermMinutes: 60,
        sync: false,
        fiction: 1,
        extend: false,
        blockGeneralCreate: 0,
        npcMode: 0,
        showImgLevel: 0,
        tournamentTrig: false,
        joinMode: 'full' as const,
        gitRef: 'HEAD',
    };

    const buildResetOperation = (input: GatewayOperationCreateInput) => ({
        id: '22222222-2222-4222-8222-222222222222',
        profileName: input.profileName,
        type: 'RESET' as const,
        status: 'QUEUED' as const,
        sourceMode: input.sourceMode,
        sourceRef: input.sourceRef,
        payload: input.payload ?? {},
        requestedBy: input.requestedBy,
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
    });

    it('queues profiles.install instead of seeding the live database directly', async () => {
        const harness = await buildCaller(async (input) => buildResetOperation(input));

        await expect(
            harness.caller.admin.profiles.install({
                profileName: 'che:2',
                install,
                reason: 'durable install',
            })
        ).resolves.toMatchObject({ ok: true, operationId: '22222222-2222-4222-8222-222222222222' });
        expect(harness.createdInputs).toHaveLength(1);
        expect(harness.createdInputs[0]).toMatchObject({
            profileName: 'che:2',
            type: 'RESET',
            sourceMode: 'COMMIT',
            reason: 'durable install',
        });
        expect(harness.createdInputs[0]?.payload).toMatchObject({
            install: {
                scenarioId: 1010,
                adminUser: { id: harness.admin.id },
            },
        });
    });

    it('queues installNow through the same reset operation boundary', async () => {
        const harness = await buildCaller(async (input) => buildResetOperation(input));

        await expect(
            harness.caller.admin.profiles.installNow({
                profileName: 'che:2',
                install,
                reason: 'no direct seed',
            })
        ).resolves.toEqual({ ok: true, operationId: '22222222-2222-4222-8222-222222222222' });
        expect(harness.createdInputs[0]).toMatchObject({
            type: 'RESET',
            sourceMode: 'COMMIT',
            reason: 'no direct seed',
            payload: {
                install: {
                    scenarioId: 1010,
                    adminUser: { id: harness.admin.id },
                },
            },
        });
    });
});

describe('admin runtime clock action API', () => {
    const unusedCreateOperation: GatewayProfileRepository['createOperation'] = async () => {
        throw new Error('not used');
    };

    it('resumes a paused profile through the same RUNNING reconciliation boundary', async () => {
        const harness = await buildCaller(unusedCreateOperation, { initialProfileStatus: 'PAUSED' });

        await expect(
            harness.caller.admin.profiles.requestAction({
                profileName: 'che:2',
                action: 'RESUME',
            })
        ).resolves.toMatchObject({ ok: true });
        expect(harness.updatedStatuses).toEqual(['RUNNING']);
        expect(harness.getReconcileCount()).toBe(1);
    });

    it('rejects resume outside stopped and paused states without reconciliation', async () => {
        const harness = await buildCaller(unusedCreateOperation, { initialProfileStatus: 'RUNNING' });

        await expect(
            harness.caller.admin.profiles.requestAction({
                profileName: 'che:2',
                action: 'RESUME',
            })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: 'Resume is allowed only for STOPPED or PAUSED profiles.',
        });
        expect(harness.updatedStatuses).toEqual([]);
        expect(harness.getReconcileCount()).toBe(0);
    });

    it('creates a first-class clock action owned by the authenticated administrator', async () => {
        const harness = await buildCaller(unusedCreateOperation);

        const result = await harness.caller.admin.profiles.requestAction({
            profileName: 'che:2',
            action: 'ACCELERATE',
            durationMinutes: 15,
            reason: '운영 일정 조정',
        });

        expect(result).toMatchObject({
            ok: true,
            action: {
                action: 'ACCELERATE',
                durationMinutes: 15,
                status: 'REQUESTED',
            },
        });
        expect(harness.createdRuntimeActions).toEqual([
            {
                profileName: 'che:2',
                action: 'ACCELERATE',
                durationMinutes: 15,
                reason: '운영 일정 조정',
                requestedBy: harness.admin.id,
            },
        ]);
    });

    it('reports a conflict when another clock action is still pending', async () => {
        const harness = await buildCaller(unusedCreateOperation, {
            runtimeActionCreateError: { code: 'P2002' },
        });

        await expect(
            harness.caller.admin.profiles.requestAction({
                profileName: 'che:2',
                action: 'DELAY',
                durationMinutes: 5,
            })
        ).rejects.toMatchObject({
            code: 'CONFLICT',
            message: '이 프로필의 이전 시간 조정 요청이 아직 처리 중입니다.',
        });
    });

    it('rejects a scheduled clock shift instead of silently applying it immediately', async () => {
        const harness = await buildCaller(unusedCreateOperation);

        await expect(
            harness.caller.admin.profiles.requestAction({
                profileName: 'che:2',
                action: 'ACCELERATE',
                durationMinutes: 15,
                scheduledAt: '2026-07-31T01:00:00.000Z',
            })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: 'scheduledAt is supported only for scheduled reset.',
        });
        expect(harness.createdRuntimeActions).toEqual([]);
    });

    it('rejects OPEN_SURVEY instead of reporting a false success', async () => {
        const harness = await buildCaller(unusedCreateOperation);

        await expect(
            harness.caller.admin.profiles.requestAction({
                profileName: 'che:2',
                action: 'OPEN_SURVEY',
            })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '설문은 게임 내 설문 관리 화면에서 생성해 주세요.',
        });
        expect(harness.createdRuntimeActions).toEqual([]);
    });
});

describe('admin role non-escalation', () => {
    const unusedCreateOperation: GatewayProfileRepository['createOperation'] = async () => {
        throw new Error('not used');
    };

    it('allows a scoped administrator to grant only the same scoped role', async () => {
        const harness = await buildCaller(unusedCreateOperation, {
            adminRoles: ['user', 'admin.users.manage', 'admin.survey.open:che:default'],
            firstUserIsAdmin: false,
        });
        const target = await harness.users.createUser({
            username: 'target-user',
            password: 'secretpass',
            displayName: 'Target',
        });

        await expect(
            harness.caller.admin.users.updateRoles({
                userId: target.id,
                roles: ['admin.survey.open:che:default'],
                mode: 'grant',
            })
        ).resolves.toMatchObject({
            roles: ['user', 'admin.survey.open:che:default'],
        });
    });

    it.each(['admin.survey.open:*', 'admin.survey.open:hwe:default', 'superuser', 'admin'])(
        'rejects granting a broader or root role: %s',
        async (role) => {
            const harness = await buildCaller(unusedCreateOperation, {
                adminRoles: ['user', 'admin.users.manage', 'admin.survey.open:che:default'],
                firstUserIsAdmin: false,
            });
            const target = await harness.users.createUser({
                username: `target-${role.replaceAll(/[^a-z]/g, '-')}`,
                password: 'secretpass',
                displayName: 'Target',
            });

            await expect(
                harness.caller.admin.users.updateRoles({
                    userId: target.id,
                    roles: [role],
                    mode: 'grant',
                })
            ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        }
    );

    it('rejects set mode when it would remove a role outside the caller scope', async () => {
        const harness = await buildCaller(unusedCreateOperation, {
            adminRoles: ['user', 'admin.users.manage'],
            firstUserIsAdmin: false,
        });
        const target = await harness.users.createUser({
            username: 'privileged-target',
            password: 'secretpass',
            displayName: 'Privileged Target',
        });
        await harness.users.updateRoles(target.id, ['user', 'admin.survey.open:*']);

        await expect(
            harness.caller.admin.users.updateRoles({
                userId: target.id,
                roles: ['user'],
                mode: 'set',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects self-escalation to a broader wildcard scope', async () => {
        const harness = await buildCaller(unusedCreateOperation, {
            adminRoles: ['user', 'admin.users.manage', 'admin.survey.open:che:default'],
            firstUserIsAdmin: false,
        });

        await expect(
            harness.caller.admin.users.updateRoles({
                userId: harness.admin.id,
                roles: ['admin.survey.open:*'],
                mode: 'grant',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect((await harness.users.findById(harness.admin.id))?.roles).toEqual([
            'user',
            'admin.users.manage',
            'admin.survey.open:che:default',
        ]);
    });

    it('allows a superuser to change root roles', async () => {
        const harness = await buildCaller(unusedCreateOperation);
        const target = await harness.users.createUser({
            username: 'admin-target',
            password: 'secretpass',
            displayName: 'Admin Target',
        });

        await expect(
            harness.caller.admin.users.updateRoles({
                userId: target.id,
                roles: ['superuser'],
                mode: 'grant',
            })
        ).resolves.toMatchObject({ roles: ['user', 'superuser'] });
    });

    it('flushes active sessions after role and sanction changes', async () => {
        const harness = await buildCaller(unusedCreateOperation);
        const target = await harness.users.createUser({
            username: 'flush-target',
            password: 'secretpass',
            displayName: 'Flush Target',
        });

        await harness.caller.admin.users.updateRoles({
            userId: target.id,
            roles: ['admin.survey.open:che:default'],
            mode: 'grant',
        });
        await harness.caller.admin.users.updateSanctions({
            userId: target.id,
            patch: { suspendedUntil: '2099-01-01T00:00:00.000Z' },
        });
        await harness.caller.admin.users.setServerRestriction({
            userId: target.id,
            profile: 'che:default',
            restriction: { blockedFeatures: ['login'] },
        });

        expect(harness.flushes).toEqual([
            { userId: target.id, reason: 'admin-roles-updated' },
            { userId: target.id, reason: 'admin-sanctions-updated' },
            { userId: target.id, reason: 'admin-server-restriction' },
        ]);
    });

    it('keeps profile icon reset revisions monotonic and outside generic sanction patches', async () => {
        const harness = await buildCaller(unusedCreateOperation);
        const target = await harness.users.createUser({
            username: 'icon-reset-target',
            password: 'secretpass',
            displayName: 'Icon Reset Target',
        });
        const frozenNow = new Date(target.createdAt);
        await harness.users.updateIcon(target.id, 'custom.png', 1, frozenNow);
        const first = await harness.users.resetProfileIcon(target.id, frozenNow);
        const second = await harness.users.resetProfileIcon(target.id, frozenNow);

        expect(new Date(first!).getTime()).toBe(new Date(target.createdAt).getTime() + 1);
        expect(new Date(second!).getTime()).toBe(new Date(first!).getTime() + 1);
        await expect(
            harness.caller.admin.users.updateSanctions({
                userId: target.id,
                patch: {
                    profileIconResetAt: null,
                },
            } as never)
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

        const result = await harness.caller.admin.users.resetProfileIcon({ userId: target.id });
        expect(new Date(result.profileIconResetAt).getTime()).toBeGreaterThan(new Date(second!).getTime());
        expect((await harness.users.findById(target.id))?.profileIconResetAt).toBe(result.profileIconResetAt);
        expect(harness.flushes.at(-1)).toEqual({
            userId: target.id,
            reason: 'admin-profile-icon-reset',
            iconRevision: result.profileIconResetAt,
        });
    });
});
