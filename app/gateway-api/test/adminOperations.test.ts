import { describe, expect, it } from 'vitest';

import type { GatewayPrismaClient } from '@sammo-ts/infra';

import { InMemoryGatewaySessionService } from '../src/auth/inMemorySessionService.js';
import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';
import type {
    GatewayOperationCreateInput,
    GatewayOperationRecord,
    GatewayProfileRecord,
    GatewayProfileRepository,
} from '../src/orchestrator/profileRepository.js';
import type {
    GatewayReleaseOperationCreateInput,
    GatewayReleaseOperationRecord,
    GatewayReleaseRepository,
} from '../src/orchestrator/gatewayReleaseRepository.js';
import { createGatewayApiContext } from '../src/context.js';
import { InMemoryProfileStatusService } from '../src/lobby/profileStatusService.js';
import { appRouter } from '../src/router.js';
import { createPasswordEnvelopeService } from '../src/auth/passwordEnvelope.js';
import type { AdminAuditEventRecord, AdminAuditWrite } from '../src/adminAudit.js';

const buildCaller = async (
    createOperation: GatewayProfileRepository['createOperation'],
    options: {
        adminRoles?: string[];
        firstUserIsAdmin?: boolean;
        runtimeActionCreateError?: unknown;
        initialNotice?: string;
        initialProfileStatus?: GatewayProfileRecord['status'];
        profileScenario?: string | null;
        profileMeta?: GatewayProfileRecord['meta'];
        gameIsUnited?: number;
        releaseCommitSha?: string;
        initialOperation?: GatewayOperationRecord;
        profileLogVisibilityAfterPolls?: number;
        releaseLogVisibilityAfterPolls?: number;
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
    const createdReleaseInputs: GatewayReleaseOperationCreateInput[] = [];
    const appendedReleaseLogs: Array<{ operationId: string; phase: string; message: string }> = [];
    const profileLogs: Array<{
        cursor: string;
        operationId: string;
        level: 'INFO' | 'OUTPUT' | 'ERROR';
        phase: string;
        message: string;
        createdAt: string;
    }> = [];
    const releaseLogs = [
        {
            cursor: '1',
            operationId: '44444444-4444-4444-8444-444444444444',
            level: 'INFO' as const,
            phase: 'build',
            message: 'Gateway 구성 요소를 빌드합니다.',
            createdAt: '2026-08-01T00:00:01.000Z',
        },
    ];
    let releaseLogPollCount = 0;
    let profileLogPollCount = 0;
    const operationRecords = new Map<string, Awaited<ReturnType<GatewayProfileRepository['createOperation']>>>();
    if (options.initialOperation) operationRecords.set(options.initialOperation.id, options.initialOperation);
    const createdRuntimeActions: Array<Record<string, unknown>> = [];
    const flushes: Array<{
        userId: string;
        reason?: string;
        iconRevision?: string;
        displayName?: string;
        identityRevision?: string;
    }> = [];
    const updatedStatuses: GatewayProfileRecord['status'][] = [];
    const updatedMetas: Record<string, unknown>[] = [];
    const auditEvents: AdminAuditEventRecord[] = [];
    let reconcileCount = 0;
    let runtimeStateListCount = 0;
    let storedNotice = options.initialNotice ?? '';
    const profile = {
        profileName: 'che:2',
        profile: 'che',
        instanceKey: '2',
        currentScenario: Object.hasOwn(options, 'profileScenario') ? (options.profileScenario ?? null) : '2',
        scenario: options.profileScenario ?? '2',
        apiPort: 15003,
        status: options.initialProfileStatus ?? ('STOPPED' as const),
        buildStatus: 'SUCCEEDED' as const,
        buildCommitSha: 'HEAD',
        meta: options.profileMeta ?? {},
        createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z',
    };
    const profiles: GatewayProfileRepository = {
        listProfiles: async () => [profile],
        getProfile: async () => profile,
        upsertProfile: async () => profile,
        updateCurrentScenario: async () => profile,
        updateStatus: async (_profileName, status) => {
            updatedStatuses.push(status);
            return { ...profile, status };
        },
        updateBuildStatus: async () => profile,
        updateMeta: async (_profileName, meta) => {
            updatedMetas.push(meta);
            return profile;
        },
        listReservedToStart: async () => [],
        findQueuedBuild: async () => null,
        updateLastError: async () => {},
        updateWorkspaceUsage: async () => {},
        clearWorkspaceUsage: async () => {},
        listOperations: async () => [],
        getOperation: async (id) => operationRecords.get(id) ?? null,
        listOperationLogs: async (id, afterCursor) => {
            profileLogPollCount += 1;
            if (
                options.profileLogVisibilityAfterPolls !== undefined &&
                profileLogPollCount < options.profileLogVisibilityAfterPolls
            ) {
                return [];
            }
            return profileLogs.filter(
                (entry) => entry.operationId === id && (!afterCursor || BigInt(entry.cursor) > BigInt(afterCursor))
            );
        },
        appendOperationLog: async (operationId, input) => {
            const entry = {
                cursor: String(profileLogs.length + 1),
                operationId,
                createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, profileLogs.length + 1)).toISOString(),
                ...input,
            };
            profileLogs.push(entry);
            return entry;
        },
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
    const releases: GatewayReleaseRepository = {
        getState: async () => ({
            id: 'gateway',
            activeCommitSha: options.releaseCommitSha ?? '1111111111111111111111111111111111111111',
            activeWorkspace: '/srv/sammo/current',
            previousCommitSha: '2222222222222222222222222222222222222222',
            previousWorkspace: '/srv/sammo/previous',
            updatedAt: '2026-08-01T00:00:00.000Z',
        }),
        listOperations: async () => [],
        getOperation: async (id) =>
            id === '44444444-4444-4444-8444-444444444444'
                ? {
                      id,
                      type: 'DEPLOY',
                      status: 'RUNNING',
                      payload: {},
                      requestedBy: admin.id,
                      attempts: 1,
                      createdAt: '2026-08-01T00:00:00.000Z',
                      updatedAt: '2026-08-01T00:00:00.000Z',
                  }
                : null,
        listOperationLogs: async (_id, afterCursor) => {
            releaseLogPollCount += 1;
            if (
                options.releaseLogVisibilityAfterPolls !== undefined &&
                releaseLogPollCount < options.releaseLogVisibilityAfterPolls
            ) {
                return [];
            }
            return releaseLogs.filter((entry) => !afterCursor || BigInt(entry.cursor) > BigInt(afterCursor));
        },
        appendOperationLog: async (operationId, input) => {
            appendedReleaseLogs.push({ operationId, phase: input.phase, message: input.message });
            return {
                cursor: '2',
                operationId,
                createdAt: '2026-08-01T00:00:02.000Z',
                ...input,
            };
        },
        createOperation: async (input) => {
            createdReleaseInputs.push(input);
            return {
                id: '44444444-4444-4444-8444-444444444444',
                type: input.type,
                status: 'QUEUED',
                sourceMode: input.sourceMode,
                sourceRef: input.sourceRef,
                payload: input.payload ?? {},
                reason: input.reason,
                requestedBy: input.requestedBy,
                attempts: 0,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
            } satisfies GatewayReleaseOperationRecord;
        },
        claimNextOperation: async () => null,
        renewOperationLease: async () => false,
        pinOperationResolvedCommit: async () => false,
        completeOperation: async () => {
            throw new Error('not used');
        },
        publishRelease: async () => {
            throw new Error('not used');
        },
        recordStateError: async () => {},
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
                        ...(metadata?.displayName ? { displayName: metadata.displayName } : {}),
                        ...(metadata?.identityRevision ? { identityRevision: metadata.identityRevision } : {}),
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
            adminAudit: {
                append: async (event: AdminAuditWrite) => {
                    auditEvents.push({
                        id: `audit-${auditEvents.length + 1}`,
                        credentialKind: 'SESSION',
                        createdAt: new Date(1_700_000_000_000 + auditEvents.length).toISOString(),
                        summary: {},
                        ...event,
                    });
                },
                list: async (input = {}) =>
                    auditEvents
                        .filter(
                            (event) =>
                                (!input.actorUserId || event.actorUserId === input.actorUserId) &&
                                (!input.targetType || event.targetType === input.targetType) &&
                                (!input.targetId || event.targetId === input.targetId) &&
                                (!input.profileName || event.profileName === input.profileName)
                        )
                        .slice()
                        .reverse()
                        .slice(0, input.limit ?? 100),
            },
            profiles,
            releases,
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
                listRuntimeSettings: async () => [
                    {
                        profileName: 'che:2',
                        isUnited: options.gameIsUnited ?? 0,
                        turnTermMinutes: 20,
                        blockGeneralCreate: 2,
                        autorunUser: { limitMinutes: 720, options: ['develop', 'recruit_high', 'chief'] },
                    },
                ],
                listRuntimeStates: async () => {
                    runtimeStateListCount += 1;
                    return [];
                },
            },
            profileStatus: new InMemoryProfileStatusService(),
            requestHeaders: { 'x-session-token': session.sessionToken },
            prisma: {
                appUser: {
                    findFirst: async () => ({ id: options.firstUserIsAdmin === false ? 'bootstrap-user' : admin.id }),
                },
                gatewayRuntimeAction: {
                    findMany: async () => [],
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
                gatewayOperation: {
                    findMany: async () => [],
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
        createdReleaseInputs,
        appendedReleaseLogs,
        profileLogs,
        createdRuntimeActions,
        users,
        admin,
        flushes,
        updatedStatuses,
        updatedMetas,
        auditEvents,
        getReconcileCount: () => reconcileCount,
        getRuntimeStateListCount: () => runtimeStateListCount,
        getStoredNotice: () => storedNotice,
        getReleaseLogPollCount: () => releaseLogPollCount,
        getProfileLogPollCount: () => profileLogPollCount,
        setStoredNotice: (notice: string) => {
            storedNotice = notice;
        },
    };
};

describe('admin profile navigation API', () => {
    it('returns the scoped menu inventory without loading PM2 runtime state', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            { adminRoles: ['admin.profiles.settings:che:2'], firstUserIsAdmin: false }
        );

        await expect(harness.caller.admin.profiles.listNavigation()).resolves.toEqual([
            {
                profileName: 'che:2',
                profile: 'che',
                instanceKey: '2',
                displayName: '체 [2]',
                currentScenario: '2',
                meta: { korName: '체' },
            },
        ]);
        expect(harness.getRuntimeStateListCount()).toBe(0);
    });

    it('returns live settings from the profile database separately from reset defaults', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            {
                profileMeta: {
                    resetDefaults: {
                        turnTermMinutes: 60,
                        blockGeneralCreate: 0,
                        autorunUser: null,
                    },
                },
            }
        );

        const result = await harness.caller.admin.profiles.list();

        expect(result[0]?.runtimeSettings).toEqual({
            profileName: 'che:2',
            isUnited: 0,
            turnTermMinutes: 20,
            blockGeneralCreate: 2,
            autorunUser: { limitMinutes: 720, options: ['develop', 'recruit_high', 'chief'] },
        });
    });
});

describe('admin scenario catalog API', () => {
    it('marks scenario zero as the current selectable scenario', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            { profileScenario: '0' }
        );

        const scenarios = await harness.caller.admin.profiles.listScenarios({
            profileName: 'che:2',
            sourceMode: 'CURRENT',
        });

        expect(scenarios.find((scenario) => scenario.id === 0)?.isCurrent).toBe(true);
    });
});

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
    it('queues game cancellation only with its dedicated scoped capability', async () => {
        const harness = await buildCaller(
            async (input) => ({
                id: '77777777-7777-4777-8777-777777777777',
                profileName: input.profileName,
                type: input.type,
                status: 'QUEUED',
                sourceMode: input.sourceMode,
                sourceRef: input.sourceRef,
                payload: input.payload ?? {},
                reason: input.reason,
                requestedBy: input.requestedBy,
                createdAt: '2026-08-18T00:00:00.000Z',
                updatedAt: '2026-08-18T00:00:00.000Z',
            }),
            {
                adminRoles: ['admin.games.cancel:che:2'],
                firstUserIsAdmin: false,
                initialProfileStatus: 'RUNNING',
                releaseCommitSha: 'HEAD',
            }
        );

        await harness.caller.admin.operations.requestGameCancellation({
            profileName: 'che:2',
            historyMode: 'RETAIN_ABANDONED',
            generalMode: 'DELETE',
            earnedPointRetentionPercent: 35,
            reason: '잘못 연 게임 취소',
        });

        expect(harness.createdInputs[0]).toMatchObject({
            profileName: 'che:2',
            type: 'CANCEL_GAME',
            sourceMode: 'COMMIT',
            sourceRef: expect.stringMatching(/^[0-9a-f]{40}$/u),
            payload: {
                historyMode: 'RETAIN_ABANDONED',
                generalMode: 'DELETE',
                earnedPointRetentionPercent: 35,
            },
            reason: '잘못 연 게임 취소',
        });
    });

    it('does not treat scenario reset permission as game cancellation permission', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            {
                adminRoles: ['admin.scenarios.reset:che:2'],
                firstUserIsAdmin: false,
                initialProfileStatus: 'RUNNING',
                releaseCommitSha: 'HEAD',
            }
        );

        await expect(
            harness.caller.admin.operations.requestGameCancellation({
                profileName: 'che:2',
                historyMode: 'DELETE',
                generalMode: 'DELETE',
                earnedPointRetentionPercent: 0,
                reason: '잘못 연 게임 취소',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects cancellation after the profile is already terminal', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            {
                adminRoles: ['admin.games.cancel:che:2'],
                firstUserIsAdmin: false,
                initialProfileStatus: 'COMPLETED',
                releaseCommitSha: 'HEAD',
            }
        );

        await expect(
            harness.caller.admin.operations.requestGameCancellation({
                profileName: 'che:2',
                historyMode: 'RETAIN_ABANDONED',
                generalMode: 'RETAIN',
                earnedPointRetentionPercent: 0,
                reason: '완료 게임 취소 시도',
            })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

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
        const harness = await buildCaller(
            async () => {
                throw { code: 'P2002' };
            },
            { initialProfileStatus: 'RUNNING' }
        );

        await expect(
            harness.caller.admin.operations.requestRuntime({
                profileName: 'che:2',
                action: 'STOP',
            })
        ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('queues a DB-preserving profile deployment with a durable release policy and no reset payload', async () => {
        const harness = await buildCaller(
            async (input) => ({
                id: '33333333-3333-4333-8333-333333333333',
                profileName: input.profileName,
                type: 'DEPLOY',
                status: 'QUEUED',
                sourceMode: input.sourceMode,
                sourceRef: input.sourceRef,
                payload: {},
                requestedBy: input.requestedBy,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
            }),
            { profileScenario: '1010' }
        );

        await harness.caller.admin.operations.requestDeploy({
            profileName: 'che:2',
            sourceMode: 'COMMIT',
            sourceRef: 'HEAD',
            reason: 'preserve live season',
        });

        expect(harness.createdInputs[0]).toMatchObject({
            profileName: 'che:2',
            type: 'DEPLOY',
            sourceMode: 'COMMIT',
            reason: 'preserve live season',
            payload: {
                releaseSource: {
                    mode: 'COMMIT',
                    ref: expect.stringMatching(/^[0-9a-f]{40}$/u),
                },
            },
        });
        expect(harness.createdInputs[0]?.payload).not.toHaveProperty('install');
    });

    it('lets a scenario-only operator reset from the configured branch latest without selecting Git', async () => {
        const harness = await buildCaller(
            async (input) => ({
                id: '55555555-5555-4555-8555-555555555555',
                profileName: input.profileName,
                type: 'RESET',
                status: 'QUEUED',
                sourceMode: input.sourceMode,
                sourceRef: input.sourceRef,
                payload: input.payload ?? {},
                requestedBy: input.requestedBy,
                createdAt: '2026-08-08T00:00:00.000Z',
                updatedAt: '2026-08-08T00:00:00.000Z',
            }),
            {
                adminRoles: ['admin.scenarios.reset:che:2'],
                firstUserIsAdmin: false,
                profileScenario: '1010',
                profileMeta: { releaseSource: { mode: 'BRANCH', ref: 'main' } },
            }
        );

        await harness.caller.admin.operations.requestReset({
            profileName: 'che:2',
            sourceMode: 'CURRENT',
            install: {
                scenarioId: 1010,
                turnTermMinutes: 60,
                sync: false,
                fiction: 1,
                extend: false,
                blockGeneralCreate: 0,
                npcMode: 0,
                showImgLevel: 0,
                tournamentTrig: false,
                joinMode: 'full',
            },
            reason: 'new season only',
        });

        expect(harness.createdInputs[0]).toMatchObject({
            type: 'RESET',
            sourceMode: 'BRANCH',
            sourceRef: 'main',
            reason: 'new season only',
        });
    });

    it('keeps reset start, preopen, and formal open as an ordered lifecycle', async () => {
        const harness = await buildCaller(async (input) => ({
            id: '77777777-7777-4777-8777-777777777777',
            profileName: input.profileName,
            type: 'RESET',
            status: 'QUEUED',
            sourceMode: input.sourceMode,
            sourceRef: input.sourceRef,
            payload: input.payload ?? {},
            requestedBy: input.requestedBy,
            scheduledAt: input.scheduledAt,
            createdAt: '2026-08-08T00:00:00.000Z',
            updatedAt: '2026-08-08T00:00:00.000Z',
        }));
        const install = {
            scenarioId: 1010,
            turnTermMinutes: 60,
            sync: false,
            fiction: 1 as const,
            extend: false,
            blockGeneralCreate: 0 as const,
            npcMode: 0 as const,
            showImgLevel: 0 as const,
            tournamentTrig: false,
            joinMode: 'full' as const,
            preopenAt: '2099-01-01T01:00:00.000Z',
            openAt: '2099-01-01T02:00:00.000Z',
        };

        await harness.caller.admin.operations.requestReset({
            profileName: 'che:2',
            sourceMode: 'COMMIT',
            sourceRef: 'HEAD',
            scheduledAt: '2099-01-01T00:00:00.000Z',
            publishSchedule: true,
            install,
        });

        expect(harness.createdInputs[0]).toMatchObject({
            type: 'RESET',
            scheduledAt: '2099-01-01T00:00:00.000Z',
            payload: {
                install,
                publicAnnouncement: {
                    enabled: true,
                    scenarioId: 1010,
                    scenarioTitle: expect.any(String),
                    scheduledAt: '2099-01-01T00:00:00.000Z',
                    preopenAt: install.preopenAt,
                    openAt: install.openAt,
                    turnTermMinutes: 60,
                    fictionMode: '가상',
                    npcMode: 0,
                    defaultStatTotal: expect.any(Number),
                    otherTextInfo: expect.any(String),
                    autorunUser: null,
                },
            },
        });

        await harness.caller.admin.operations.requestReset({
            profileName: 'che:2',
            sourceMode: 'COMMIT',
            sourceRef: 'HEAD',
            install,
        });

        expect(harness.createdInputs[1]).toMatchObject({
            type: 'RESET',
            scheduledAt: undefined,
            payload: {
                install,
                publicAnnouncement: {
                    enabled: false,
                    scenarioId: 1010,
                    scenarioTitle: expect.any(String),
                    scheduledAt: null,
                    preopenAt: install.preopenAt,
                    openAt: install.openAt,
                    turnTermMinutes: 60,
                    fictionMode: '가상',
                    npcMode: 0,
                    defaultStatTotal: expect.any(Number),
                    otherTextInfo: expect.any(String),
                    autorunUser: null,
                },
            },
        });

        await expect(
            harness.caller.admin.operations.requestReset({
                profileName: 'che:2',
                sourceMode: 'COMMIT',
                sourceRef: 'HEAD',
                scheduledAt: '2099-01-01T01:30:00.000Z',
                install,
            })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: 'preopenAt cannot be earlier than scheduledAt.',
        });

        await expect(
            harness.caller.admin.operations.requestReset({
                profileName: 'che:2',
                sourceMode: 'COMMIT',
                sourceRef: 'HEAD',
                scheduledAt: '2099-01-01T00:00:00.000Z',
                publishSchedule: true,
                install: { ...install, preopenAt: undefined },
            })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '로비 일정 공개에는 초기화 시작, 가오픈 시작과 정식 오픈이 모두 필요합니다.',
        });
    });

    it('returns validated profile reset defaults to a scenario-only operator', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            {
                adminRoles: ['admin.scenarios.reset:che:2'],
                firstUserIsAdmin: false,
                profileMeta: {
                    resetDefaults: {
                        turnTermMinutes: 20,
                        sync: false,
                        fiction: 0,
                        extend: false,
                        blockGeneralCreate: 2,
                        npcMode: 1,
                        showImgLevel: 1,
                        tournamentTrig: false,
                        joinMode: 'onlyRandom',
                        autorunUser: { limitMinutes: 720, options: ['develop', 'train'] },
                    },
                },
            }
        );

        await expect(harness.caller.admin.profiles.getResetDefaults({ profileName: 'che:2' })).resolves.toEqual({
            source: 'PROFILE',
            defaults: {
                turnTermMinutes: 20,
                sync: false,
                fiction: 0,
                extend: false,
                blockGeneralCreate: 2,
                npcMode: 1,
                showImgLevel: 1,
                tournamentTrig: false,
                joinMode: 'onlyRandom',
                autorunUser: { limitMinutes: 720, options: ['develop', 'train'] },
            },
        });
    });

    it('falls back to system reset defaults when profile metadata is malformed', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            {
                adminRoles: ['admin.scenarios.reset:che:2'],
                firstUserIsAdmin: false,
                profileMeta: { resetDefaults: { npcMode: 99 } },
            }
        );

        await expect(harness.caller.admin.profiles.getResetDefaults({ profileName: 'che:2' })).resolves.toMatchObject({
            source: 'SYSTEM',
            defaults: { turnTermMinutes: 60, npcMode: 0, tournamentTrig: true, autorunUser: null },
        });
    });

    it('stores reset defaults only after validating the complete metadata object', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            { adminRoles: ['admin.profiles.settings:che:2'], firstUserIsAdmin: false }
        );
        const resetDefaults = {
            turnTermMinutes: 3,
            sync: true,
            fiction: 1 as const,
            extend: true,
            blockGeneralCreate: 0 as const,
            npcMode: 2 as const,
            showImgLevel: 3 as const,
            tournamentTrig: true,
            joinMode: 'full' as const,
            autorunUser: null,
        };

        await harness.caller.admin.profiles.updateMeta({
            profileName: 'che:2',
            patch: { resetDefaults },
            reason: 'set server reset defaults',
        });
        expect(harness.updatedMetas.at(-1)).toMatchObject({ resetDefaults });

        await expect(
            harness.caller.admin.profiles.updateMeta({
                profileName: 'che:2',
                patch: { resetDefaults: { ...resetDefaults, turnTermMinutes: 7 } },
                reason: 'reject invalid reset defaults',
            })
        ).rejects.toBeDefined();
    });

    it('queues a three-minute reset because it is a valid divisor of 120', async () => {
        const harness = await buildCaller(async (input) => ({
            id: '66666666-6666-4666-8666-666666666666',
            profileName: input.profileName,
            type: 'RESET',
            status: 'QUEUED',
            sourceMode: input.sourceMode,
            sourceRef: input.sourceRef,
            payload: input.payload ?? {},
            requestedBy: input.requestedBy,
            createdAt: '2026-08-21T00:00:00.000Z',
            updatedAt: '2026-08-21T00:00:00.000Z',
        }));

        await harness.caller.admin.operations.requestReset({
            profileName: 'che:2',
            sourceMode: 'COMMIT',
            sourceRef: 'HEAD',
            install: {
                scenarioId: 1010,
                turnTermMinutes: 3,
                sync: true,
                fiction: 1,
                extend: true,
                blockGeneralCreate: 0,
                npcMode: 0,
                showImgLevel: 3,
                tournamentTrig: true,
                joinMode: 'full',
            },
        });

        expect(harness.createdInputs[0]).toMatchObject({
            type: 'RESET',
            payload: { install: { turnTermMinutes: 3 } },
        });
    });

    it('stores event season zero as the next season number', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            { adminRoles: ['admin.profiles.settings:che:2'], firstUserIsAdmin: false }
        );

        await harness.caller.admin.profiles.updateMeta({
            profileName: 'che:2',
            patch: { nextSeasonIdx: 0 },
            reason: 'prepare event season',
        });
        expect(harness.updatedMetas.at(-1)).toMatchObject({ nextSeasonIdx: 0 });

        await expect(
            harness.caller.admin.profiles.updateMeta({
                profileName: 'che:2',
                patch: { nextSeasonIdx: -1 },
                reason: 'reject negative season',
            })
        ).rejects.toBeDefined();
    });

    it('stores zero as the first game index and rejects negative values', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            { adminRoles: ['admin.profiles.settings:che:2'], firstUserIsAdmin: false }
        );

        await harness.caller.admin.profiles.updateMeta({
            profileName: 'che:2',
            patch: { firstGameIdx: 0 },
            reason: 'start core series at zero',
        });
        expect(harness.updatedMetas.at(-1)).toMatchObject({ firstGameIdx: 0 });

        await expect(
            harness.caller.admin.profiles.updateMeta({
                profileName: 'che:2',
                patch: { firstGameIdx: -1 },
                reason: 'reject negative game index',
            })
        ).rejects.toBeDefined();
    });

    it('does not let a scenario-only operator combine a Git update with reset', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            { adminRoles: ['admin.scenarios.reset:che:2'], firstUserIsAdmin: false }
        );

        await expect(
            harness.caller.admin.operations.requestReset({
                profileName: 'che:2',
                sourceMode: 'BRANCH',
                sourceRef: 'main',
                install: {
                    scenarioId: 1010,
                    turnTermMinutes: 60,
                    sync: false,
                    fiction: 1,
                    extend: false,
                    blockGeneralCreate: 0,
                    npcMode: 0,
                    showImgLevel: 0,
                    tournamentTrig: false,
                    joinMode: 'full',
                },
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('keeps runtime and DB-preserving deploy permissions independent', async () => {
        const harness = await buildCaller(
            async (input) => ({
                id: '66666666-6666-4666-8666-666666666666',
                profileName: input.profileName,
                type: input.type,
                status: 'QUEUED',
                payload: {},
                requestedBy: input.requestedBy,
                createdAt: '2026-08-08T00:00:00.000Z',
                updatedAt: '2026-08-08T00:00:00.000Z',
            }),
            { adminRoles: ['admin.profiles.runtime:che:2'], firstUserIsAdmin: false }
        );

        await expect(
            harness.caller.admin.operations.requestRuntime({ profileName: 'che:2', action: 'START' })
        ).resolves.toMatchObject({ type: 'START' });
        await expect(
            harness.caller.admin.operations.requestDeploy({
                profileName: 'che:2',
                sourceMode: 'BRANCH',
                sourceRef: 'main',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('lets a settings-only operator change profile policy without runtime control', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            { adminRoles: ['admin.profiles.settings:che:2'], firstUserIsAdmin: false }
        );

        await harness.caller.admin.profiles.updateMeta({
            profileName: 'che:2',
            patch: { color: '#112233', localAccountAccessGraceDays: 14 },
            reason: 'profile policy delegation',
        });
        expect(harness.updatedMetas.at(-1)).toMatchObject({ color: '#112233', localAccountAccessGraceDays: 14 });
        await expect(
            harness.caller.admin.operations.requestRuntime({ profileName: 'che:2', action: 'STOP' })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('returns the authenticated profile scopes with the capability catalog', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            { adminRoles: ['admin.scenarios.reset:che:2'], firstUserIsAdmin: false }
        );

        const capabilities = await harness.caller.admin.capabilities.list();
        expect(capabilities).toContainEqual(
            expect.objectContaining({ permission: 'admin.scenarios.reset', scopes: ['che:2'] })
        );
        expect(capabilities).not.toContainEqual(expect.objectContaining({ permission: 'admin.profiles.manage' }));
    });

    it('lists only bulk-update targets covered by the authenticated release capabilities', async () => {
        const profileOperator = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            { adminRoles: ['admin.profiles.deploy:che:2'], firstUserIsAdmin: false }
        );
        await expect(profileOperator.caller.admin.bulkReleases.targets()).resolves.toMatchObject({
            gateway: false,
            profiles: [{ profileName: 'che:2' }],
        });

        const gatewayOperator = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            { adminRoles: ['admin.releases.manage'], firstUserIsAdmin: false }
        );
        await expect(gatewayOperator.caller.admin.bulkReleases.targets()).resolves.toEqual({
            gateway: true,
            profiles: [],
        });
    });
});

describe('profile operation progress API', () => {
    it('long-polls durable build logs with the current profile operation state', async () => {
        const operationId = '33333333-3333-4333-8333-333333333333';
        const harness = await buildCaller(
            async (input) => ({
                id: operationId,
                profileName: input.profileName,
                type: 'DEPLOY',
                status: 'RUNNING',
                sourceMode: input.sourceMode,
                sourceRef: input.sourceRef,
                payload: {},
                requestedBy: input.requestedBy,
                createdAt: '2026-08-11T00:00:00.000Z',
                updatedAt: '2026-08-11T00:00:00.000Z',
            }),
            { profileScenario: '1010', profileLogVisibilityAfterPolls: 2 }
        );
        await harness.caller.admin.operations.requestDeploy({
            profileName: 'che:2',
            sourceMode: 'COMMIT',
            sourceRef: 'HEAD',
        });
        harness.profileLogs.push({
            cursor: '1',
            operationId,
            level: 'OUTPUT',
            phase: 'build',
            message: 'game-frontend build complete',
            createdAt: '2026-08-11T00:00:01.000Z',
        });

        await expect(
            harness.caller.admin.operations.logs({ id: operationId, timeoutMs: 1_000 })
        ).resolves.toMatchObject({
            nextCursor: '1',
            operation: { status: 'RUNNING', profileName: 'che:2' },
            entries: [{ cursor: '1', phase: 'build', message: 'game-frontend build complete' }],
        });
        expect(harness.getProfileLogPollCount()).toBe(2);
    });

    it('does not expose operation logs outside the caller profile scope', async () => {
        const operationId = '33333333-3333-4333-8333-333333333333';
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            {
                adminRoles: ['admin.scenarios.reset:hwe:1'],
                firstUserIsAdmin: false,
                initialOperation: {
                    id: operationId,
                    profileName: 'che:2',
                    type: 'RESET',
                    status: 'RUNNING',
                    sourceMode: 'COMMIT',
                    sourceRef: '1111111111111111111111111111111111111111',
                    payload: {},
                    requestedBy: 'admin',
                    createdAt: '2026-08-11T00:00:00.000Z',
                    updatedAt: '2026-08-11T00:00:00.000Z',
                },
            }
        );

        await expect(harness.caller.admin.operations.logs({ id: operationId, timeoutMs: 0 })).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
    });
});

describe('gateway release API', () => {
    it('waits until a new release log becomes visible', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            { releaseLogVisibilityAfterPolls: 2 }
        );

        await expect(
            harness.caller.admin.releases.logs({
                id: '44444444-4444-4444-8444-444444444444',
                timeoutMs: 1_000,
            })
        ).resolves.toMatchObject({
            nextCursor: '1',
            entries: [{ cursor: '1' }],
        });
        expect(harness.getReleaseLogPollCount()).toBe(2);
    });

    it('long-polls ordered release logs with the current operation state', async () => {
        const harness = await buildCaller(async () => {
            throw new Error('not used');
        });

        await expect(
            harness.caller.admin.releases.logs({
                id: '44444444-4444-4444-8444-444444444444',
                timeoutMs: 0,
            })
        ).resolves.toMatchObject({
            nextCursor: '1',
            operation: { status: 'RUNNING' },
            entries: [{ cursor: '1', phase: 'build', message: 'Gateway 구성 요소를 빌드합니다.' }],
        });
    });

    it('queues a gateway deployment for the external release controller', async () => {
        const harness = await buildCaller(async () => {
            throw new Error('not used');
        });

        await harness.caller.admin.releases.requestGatewayDeploy({
            sourceMode: 'COMMIT',
            sourceRef: 'HEAD',
            reason: 'gateway rollout',
        });

        expect(harness.createdReleaseInputs[0]).toMatchObject({
            type: 'DEPLOY',
            sourceMode: 'COMMIT',
            reason: 'gateway rollout',
            requestedBy: harness.admin.id,
        });
        expect(harness.createdReleaseInputs[0]?.sourceRef).toMatch(/^[0-9a-f]{40}$/u);
        expect(harness.appendedReleaseLogs).toContainEqual({
            operationId: '44444444-4444-4444-8444-444444444444',
            phase: 'queue',
            message: 'Gateway 배포 작업을 controller queue에 등록했습니다.',
        });
    });

    it('queues rollback to the previously published gateway commit', async () => {
        const harness = await buildCaller(async () => {
            throw new Error('not used');
        });

        await harness.caller.admin.releases.requestGatewayRollback({ reason: 'readiness regression' });

        expect(harness.createdReleaseInputs[0]).toMatchObject({
            type: 'ROLLBACK',
            sourceMode: 'COMMIT',
            sourceRef: '2222222222222222222222222222222222222222',
        });
        expect(harness.appendedReleaseLogs).toContainEqual({
            operationId: '44444444-4444-4444-8444-444444444444',
            phase: 'queue',
            message: 'Gateway rollback 작업을 controller queue에 등록했습니다.',
        });
    });

    it('requires the global release permission even for profile-scoped administrators', async () => {
        const harness = await buildCaller(
            async () => {
                throw new Error('not used');
            },
            { adminRoles: ['admin.profiles.runtime:che:2'], firstUserIsAdmin: false }
        );

        await expect(harness.caller.admin.releases.gatewayState()).rejects.toMatchObject({ code: 'FORBIDDEN' });
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
        expect(harness.updatedMetas).toHaveLength(2);
        expect(harness.updatedMetas.at(-1)).toMatchObject({
            adminActions: [
                {
                    action: 'RESUME',
                    status: 'APPLIED',
                    handler: 'gateway-api',
                    detail: 'profile status reconciled as RUNNING',
                },
            ],
        });
    });

    it.each([
        ['STOP', 'STOPPED'],
        ['SHUTDOWN', 'DISABLED'],
    ] as const)('records %s as terminal only after runtime reconciliation', async (action, expectedStatus) => {
        const harness = await buildCaller(unusedCreateOperation, { initialProfileStatus: 'RUNNING' });

        const result = await harness.caller.admin.profiles.requestAction({
            profileName: 'che:2',
            action,
        });

        expect(harness.updatedStatuses).toEqual([expectedStatus]);
        expect(harness.getReconcileCount()).toBe(1);
        expect(harness.updatedMetas).toHaveLength(2);
        expect(harness.updatedMetas[0]).toMatchObject({
            adminActions: [{ action, status: 'REQUESTED' }],
        });
        expect(harness.updatedMetas[1]).toMatchObject({
            adminActions: [
                {
                    action,
                    status: 'APPLIED',
                    handler: 'gateway-api',
                    detail: `profile status reconciled as ${expectedStatus}`,
                },
            ],
        });
        expect(result.action).toMatchObject({ action, status: 'APPLIED', handledAt: expect.any(String) });
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

    it('does not turn a stopped profile into an accessible paused runtime', async () => {
        const harness = await buildCaller(unusedCreateOperation, { initialProfileStatus: 'STOPPED' });

        await expect(
            harness.caller.admin.profiles.requestAction({
                profileName: 'che:2',
                action: 'PAUSE',
            })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: 'Pause is allowed only for RUNNING profiles.',
        });
        expect(harness.updatedStatuses).toEqual([]);
        expect(harness.getReconcileCount()).toBe(0);
    });

    it('requires reset before an uninitialized stopped profile can be resumed', async () => {
        const harness = await buildCaller(unusedCreateOperation, {
            initialProfileStatus: 'STOPPED',
            profileScenario: null,
        });

        await expect(
            harness.caller.admin.profiles.requestAction({
                profileName: 'che:2',
                action: 'RESUME',
            })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: 'An uninitialized profile must be reset before it can be resumed.',
        });
        expect(harness.updatedStatuses).toEqual([]);
        expect(harness.getReconcileCount()).toBe(0);
    });

    it('allows stopping an accessible paused profile', async () => {
        const harness = await buildCaller(unusedCreateOperation, { initialProfileStatus: 'PAUSED' });

        await expect(
            harness.caller.admin.profiles.requestAction({
                profileName: 'che:2',
                action: 'STOP',
            })
        ).resolves.toMatchObject({ ok: true });
        expect(harness.updatedStatuses).toEqual(['STOPPED']);
        expect(harness.getReconcileCount()).toBe(1);
    });

    it('lets a scoped scenario opener close a unified game without runtime authority', async () => {
        const harness = await buildCaller(unusedCreateOperation, {
            adminRoles: ['user', 'admin.scenarios.reset:che:2'],
            firstUserIsAdmin: false,
            initialProfileStatus: 'RUNNING',
            gameIsUnited: 2,
        });

        await expect(
            harness.caller.admin.profiles.requestAction({
                profileName: 'che:2',
                action: 'CLOSE_COMPLETED',
            })
        ).resolves.toMatchObject({ ok: true });
        expect(harness.updatedStatuses).toEqual(['STOPPED']);
        expect(harness.getReconcileCount()).toBe(1);
        expect(harness.auditEvents.at(-1)).toMatchObject({ capability: 'admin.scenarios.reset' });
    });

    it('does not let a scenario opener close a game before unification', async () => {
        const harness = await buildCaller(unusedCreateOperation, {
            adminRoles: ['user', 'admin.scenarios.reset:che:2'],
            firstUserIsAdmin: false,
            initialProfileStatus: 'RUNNING',
            gameIsUnited: 0,
        });

        await expect(
            harness.caller.admin.profiles.requestAction({
                profileName: 'che:2',
                action: 'CLOSE_COMPLETED',
            })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: 'Only a unified game can be closed by a scenario opener.',
        });
        expect(harness.updatedStatuses).toEqual([]);
        expect(harness.getReconcileCount()).toBe(0);
    });

    it('does not turn runtime authority into scenario-opener cleanup authority', async () => {
        const harness = await buildCaller(unusedCreateOperation, {
            adminRoles: ['user', 'admin.profiles.runtime:che:2'],
            firstUserIsAdmin: false,
            initialProfileStatus: 'RUNNING',
            gameIsUnited: 2,
        });

        await expect(
            harness.caller.admin.profiles.requestAction({
                profileName: 'che:2',
                action: 'CLOSE_COMPLETED',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(harness.updatedStatuses).toEqual([]);
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
                payload: {},
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
            message: '이 프로필의 이전 런타임 변경 요청이 아직 처리 중입니다.',
        });
    });

    it('queues all live game settings as one durable runtime action', async () => {
        const harness = await buildCaller(unusedCreateOperation, { initialProfileStatus: 'RUNNING' });

        const result = await harness.caller.admin.profiles.requestAction({
            profileName: 'che:2',
            action: 'UPDATE_RUNTIME_SETTINGS',
            runtimeSettings: {
                turnTermMinutes: 20,
                blockGeneralCreate: 2,
                autorunUser: {
                    limitMinutes: 720,
                    options: ['develop', 'recruit_high', 'chief'],
                },
            },
            reason: '운영 중 규칙 변경',
        });

        expect(result).toMatchObject({
            ok: true,
            action: { action: 'UPDATE_RUNTIME_SETTINGS', status: 'REQUESTED' },
        });
        expect(harness.createdRuntimeActions).toEqual([
            {
                profileName: 'che:2',
                action: 'UPDATE_RUNTIME_SETTINGS',
                payload: {
                    settings: {
                        turnTermMinutes: 20,
                        blockGeneralCreate: 2,
                        autorunUser: {
                            limitMinutes: 720,
                            options: ['develop', 'recruit_high', 'chief'],
                        },
                    },
                },
                durationMinutes: undefined,
                reason: '운영 중 규칙 변경',
                requestedBy: harness.admin.id,
            },
        ]);
    });

    it('rejects a live game setting change without a reason or running database', async () => {
        const running = await buildCaller(unusedCreateOperation, { initialProfileStatus: 'RUNNING' });
        await expect(
            running.caller.admin.profiles.requestAction({
                profileName: 'che:2',
                action: 'UPDATE_RUNTIME_SETTINGS',
                runtimeSettings: { turnTermMinutes: 20 },
            })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: '변경 사유를 입력해 주세요.' });

        const stopped = await buildCaller(unusedCreateOperation, { initialProfileStatus: 'STOPPED' });
        await expect(
            stopped.caller.admin.profiles.requestAction({
                profileName: 'che:2',
                action: 'UPDATE_RUNTIME_SETTINGS',
                runtimeSettings: { blockGeneralCreate: 1 },
                reason: '운영 정책 변경',
            })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '실행 중인 프로필에서만 현재 기수 설정을 바꿀 수 있습니다.',
        });
        expect(running.createdRuntimeActions).toEqual([]);
        expect(stopped.createdRuntimeActions).toEqual([]);
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
            message: 'scheduledAt is supported only by operations.requestReset.',
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
                reason: '권한 부여 테스트',
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
                    reason: '권한 범위 거부 테스트',
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
                reason: '권한 제거 거부 테스트',
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
                reason: '자기 권한 상승 거부 테스트',
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
                reason: '최고 관리자 권한 부여 테스트',
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
            reason: '세션 무효화 권한 테스트',
        });
        await harness.caller.admin.users.updateSanctions({
            userId: target.id,
            patch: { suspendedUntil: '2099-01-01T00:00:00.000Z' },
            reason: '세션 무효화 제재 테스트',
        });
        await harness.caller.admin.users.setServerRestriction({
            userId: target.id,
            profile: 'che:default',
            restriction: { blockedFeatures: ['login'] },
            reason: '세션 무효화 서버 제한 테스트',
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

        const result = await harness.caller.admin.users.resetProfileIcon({
            userId: target.id,
            reason: '프로필 아이콘 초기화 테스트',
        });
        expect(new Date(result.profileIconResetAt).getTime()).toBeGreaterThan(new Date(second!).getTime());
        expect((await harness.users.findById(target.id))?.profileIconResetAt).toBe(result.profileIconResetAt);
        expect(harness.flushes.at(-1)).toEqual({
            userId: target.id,
            reason: 'admin-profile-icon-reset',
            iconRevision: result.profileIconResetAt,
        });
    });
});

describe('Gateway administrator account controls', () => {
    const unusedCreateOperation: GatewayProfileRepository['createOperation'] = async () => {
        throw new Error('not used');
    };

    it('lists accounts before exact lookup and supports partial search with cursor pagination', async () => {
        const { caller, users } = await buildCaller(unusedCreateOperation);
        await users.createUser({
            username: 'alpha-user',
            password: 'secretpass',
            displayName: 'Pilot Alpha',
        });
        await users.createUser({
            username: 'kakao-user',
            password: 'secretpass',
            displayName: 'Kakao Member',
            oauth: {
                type: 'KAKAO',
                id: 'kakao-directory-id',
                email: 'pilot@example.test',
                info: {},
            },
        });

        const search = await caller.admin.users.list({ query: 'pilot', limit: 30 });
        expect(search.total).toBe(2);
        expect(search.users.map((user) => user.username).sort()).toEqual(['alpha-user', 'kakao-user']);
        expect(search.users[0]).not.toHaveProperty('oauthId');

        const firstPage = await caller.admin.users.list({ limit: 1 });
        expect(firstPage.total).toBe(3);
        expect(firstPage.users).toHaveLength(1);
        expect(firstPage.nextCursor).toBeTruthy();
        const secondPage = await caller.admin.users.list({ limit: 1, cursor: firstPage.nextCursor });
        expect(secondPage.users).toHaveLength(1);
        expect(secondPage.users[0]?.id).not.toBe(firstPage.users[0]?.id);
    });

    it('records sanitized STARTED and SUCCEEDED events and exposes target history', async () => {
        const harness = await buildCaller(unusedCreateOperation);
        const target = await harness.users.createUser({
            username: 'audit-target',
            password: 'secretpass',
            displayName: 'Audit Target',
        });

        await harness.caller.admin.users.resetPassword({
            userId: target.id,
            newPassword: 'replacement-secret',
            reason: '사용자 요청에 따른 복구',
        });

        expect(harness.auditEvents).toHaveLength(2);
        expect(harness.auditEvents.map((event) => event.outcome)).toEqual(['STARTED', 'SUCCEEDED']);
        expect(harness.auditEvents[0]).toMatchObject({
            actorUserId: harness.admin.id,
            capability: 'admin.users.manage',
            targetType: 'USER',
            targetId: target.id,
            reason: '사용자 요청에 따른 복구',
            summary: { newPassword: '[REDACTED]' },
        });
        const history = await harness.caller.admin.users.listHistory({ userId: target.id });
        expect(history.map((event) => event.outcome)).toEqual(['SUCCEEDED', 'STARTED']);
        await expect(harness.caller.admin.audit.list({ targetId: target.id })).resolves.toHaveLength(2);
    });

    it('records a FAILED terminal event when validation rejects an unknown capability', async () => {
        const harness = await buildCaller(unusedCreateOperation);
        const target = await harness.users.createUser({
            username: 'failed-audit-target',
            password: 'secretpass',
            displayName: 'Failed Audit Target',
        });

        await expect(
            harness.caller.admin.users.updateRoles({
                userId: target.id,
                roles: ['admin.unknown.manage'],
                mode: 'grant',
                reason: '알 수 없는 권한 거부 확인',
            })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        expect(harness.auditEvents.map((event) => event.outcome)).toEqual(['STARTED', 'FAILED']);
        expect(harness.auditEvents.at(-1)).toMatchObject({ errorCode: 'BAD_REQUEST' });
        expect((await harness.users.findById(target.id))?.roles).toEqual(['user']);
    });

    it('rejects the removed umbrella profile capability', async () => {
        const harness = await buildCaller(unusedCreateOperation);
        const target = await harness.users.createUser({
            username: 'removed-profile-capability-target',
            password: 'secretpass',
            displayName: 'Removed Profile Capability Target',
        });

        await expect(
            harness.caller.admin.users.updateRoles({
                userId: target.id,
                roles: ['admin.profiles.manage:che:default'],
                mode: 'grant',
                reason: '제거한 포괄 권한 거부 확인',
            })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        expect((await harness.users.findById(target.id))?.roles).toEqual(['user']);
    });

    it('extends an unverified local account grace period and flushes active sessions', async () => {
        const harness = await buildCaller(unusedCreateOperation);
        const target = await harness.users.createUser({
            username: 'grace-target',
            password: 'secretpass',
            displayName: 'Grace Target',
        });
        const until = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

        await expect(
            harness.caller.admin.users.updateKakaoGrace({
                userId: target.id,
                until,
                reason: '고객센터 본인 확인 처리 중',
            })
        ).resolves.toEqual({ kakaoGraceUntil: until });
        expect((await harness.users.findById(target.id))?.kakaoGraceUntil).toBe(until);
        expect(harness.flushes).toContainEqual({ userId: target.id, reason: 'admin-kakao-grace-updated' });
    });

    it('approves a time-bounded Kakao replacement only for an already linked account', async () => {
        const harness = await buildCaller(unusedCreateOperation);
        const target = await harness.users.createUser({
            username: 'kakao-replacement-target',
            password: 'secretpass',
            displayName: '교체대상',
            oauth: { type: 'KAKAO', id: 'former-kakao-id', email: 'former@example.com', info: {} },
        });
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        await expect(
            harness.caller.admin.users.setKakaoReplacementApproval({
                userId: target.id,
                until,
                reason: '새 Kakao 계정 본인 확인 예정',
            })
        ).resolves.toEqual({ kakaoReplacementApprovedUntil: until });
        expect(await harness.users.findById(target.id)).toMatchObject({
            kakaoReplacementApprovedUntil: until,
            kakaoReplacementApprovedByUserId: harness.admin.id,
            kakaoReplacementReason: '새 Kakao 계정 본인 확인 예정',
        });

        await expect(
            harness.caller.admin.users.setKakaoReplacementApproval({
                userId: target.id,
                until: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
                reason: '기간 상한 검증',
            })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('changes login ID and nickname while publishing a current-general projection', async () => {
        const harness = await buildCaller(unusedCreateOperation);
        const target = await harness.users.createUser({
            username: 'rename-target',
            password: 'secretpass',
            displayName: '이전닉네임',
        });

        const result = await harness.caller.admin.users.updateIdentity({
            userId: target.id,
            username: 'renamed-target',
            displayName: '새닉네임',
            reason: '사용자 본인 요청 확인',
        });

        expect(result).toMatchObject({ username: 'renamed-target', displayName: '새닉네임' });
        expect(await harness.users.findByUsername('rename-target')).toBeNull();
        expect(await harness.users.findByUsername('renamed-target')).toMatchObject({ displayName: '새닉네임' });
        expect(harness.flushes.at(-1)).toEqual({
            userId: target.id,
            reason: 'admin-account-identity-updated',
            displayName: '새닉네임',
            identityRevision: result.identityRevision,
        });
    });

    it('grants and revokes profile-scoped recovery access with an audit trail', async () => {
        const harness = await buildCaller(unusedCreateOperation);
        const target = await harness.users.createUser({
            username: 'recovery-target',
            password: 'secretpass',
            displayName: 'Recovery Target',
        });
        target.oauthType = 'KAKAO';
        target.oauthId = 'lost-phone-kakao-id';
        target.kakaoVerifiedAt = '2026-08-01T00:00:00.000Z';
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

        const grant = await harness.caller.admin.users.grantSpecialAccess({
            userId: target.id,
            kind: 'RECOVERY',
            profiles: ['che'],
            allowsGeneralCreation: true,
            expiresAt,
            reason: '휴대폰 분실 본인 확인 완료',
        });
        expect(grant).toMatchObject({
            userId: target.id,
            kind: 'RECOVERY',
            profiles: ['che'],
            allowsGeneralCreation: true,
            expiresAt,
            grantedByUserId: harness.admin.id,
        });
        expect(harness.flushes).toContainEqual({ userId: target.id, reason: 'admin-special-access-granted' });

        await expect(
            harness.caller.admin.users.revokeSpecialAccess({
                userId: target.id,
                grantId: grant.id,
                reason: 'Kakao 인증 수단 복구 완료',
            })
        ).resolves.toMatchObject({ id: grant.id, revokedReason: 'Kakao 인증 수단 복구 완료' });
        expect(harness.flushes).toContainEqual({ userId: target.id, reason: 'admin-special-access-revoked' });
        expect(
            harness.auditEvents.filter((event) => event.outcome === 'SUCCEEDED').map((event) => event.action)
        ).toEqual(['admin.users.grantSpecialAccess', 'admin.users.revokeSpecialAccess']);
    });

    it('requires recovery access to expire within 90 days', async () => {
        const harness = await buildCaller(unusedCreateOperation);
        const target = await harness.users.createUser({
            username: 'unsafe-recovery-target',
            password: 'secretpass',
            displayName: 'Unsafe Recovery Target',
        });

        await expect(
            harness.caller.admin.users.grantSpecialAccess({
                userId: target.id,
                kind: 'RECOVERY',
                profiles: [],
                allowsGeneralCreation: true,
                expiresAt: null,
                reason: '무기한 복구 예외 거부',
            })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('schedules deletion with retention and prevents administrator self-deletion', async () => {
        const harness = await buildCaller(unusedCreateOperation);
        const target = await harness.users.createUser({
            username: 'deletion-target',
            password: 'secretpass',
            displayName: 'Deletion Target',
        });

        const result = await harness.caller.admin.users.scheduleDeletion({
            userId: target.id,
            retentionDays: 30,
            reason: '탈퇴 요청 증빙 확인 완료',
        });
        expect((await harness.users.findById(target.id))?.deleteAfter).toBe(result.deleteAfter);
        await expect(
            harness.caller.admin.users.scheduleDeletion({
                userId: harness.admin.id,
                retentionDays: 30,
                reason: '관리자 자기 삭제 차단 확인',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('prevents a delegated administrator from changing a root administrator', async () => {
        const harness = await buildCaller(unusedCreateOperation, {
            adminRoles: ['user', 'admin.users.manage'],
            firstUserIsAdmin: false,
        });
        const target = await harness.users.createUser({
            username: 'root-target',
            password: 'secretpass',
            displayName: 'Root Target',
        });
        await harness.users.updateRoles(target.id, ['user', 'admin']);
        target.oauthType = 'KAKAO';
        target.oauthId = 'protected-root-kakao-id';

        await expect(
            harness.caller.admin.users.updateSanctions({
                userId: target.id,
                patch: { suspendedUntil: '2099-01-01T00:00:00.000Z' },
                reason: '루트 계정 보호 확인',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(
            harness.caller.admin.users.updateIdentity({
                userId: target.id,
                username: 'root-target-renamed',
                displayName: '변경 금지 대상',
                reason: '루트 계정 보호 확인',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(
            harness.caller.admin.users.setKakaoReplacementApproval({
                userId: target.id,
                until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                reason: '루트 계정 보호 확인',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect((await harness.users.findById(target.id))?.sanctions).toEqual({});
        const protectedUser = await harness.users.findByUsername('root-target');
        expect(protectedUser).toMatchObject({ displayName: 'Root Target' });
        expect(protectedUser?.kakaoReplacementApprovedUntil).toBeUndefined();
    });

    it('keeps the global audit feed behind its dedicated capability', async () => {
        const harness = await buildCaller(unusedCreateOperation, {
            adminRoles: ['user', 'admin.users.manage'],
            firstUserIsAdmin: false,
        });

        await expect(harness.caller.admin.audit.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
});
