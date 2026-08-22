import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { GatewayOrchestrator, type GatewayOrchestratorOptions } from '../src/orchestrator/gatewayOrchestrator.js';
import type { ProcessDefinition, ProcessManager } from '../src/orchestrator/processManager.js';
import type {
    GatewayOperationRecord,
    GatewayOperationStatus,
    GatewayProfileRecord,
    GatewayProfileRepository,
} from '../src/orchestrator/profileRepository.js';
import { GitWorkspaceManager } from '../src/orchestrator/workspaceManager.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

const profile: GatewayProfileRecord = {
    profileName: 'che:2',
    profile: 'che',
    instanceKey: '2',
    currentScenario: '2',
    scenario: '2',
    apiPort: 15003,
    status: 'STOPPED',
    buildStatus: 'SUCCEEDED',
    buildCommitSha: '0123456789abcdef0123456789abcdef01234567',
    buildWorkspace: '/srv/sammo/worktrees/0123456789abcdef',
    meta: {},
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
};

const buildOperation = (type: 'START' | 'STOP'): GatewayOperationRecord => ({
    id: '11111111-1111-4111-8111-111111111111',
    profileName: profile.profileName,
    type,
    status: 'RUNNING',
    payload: {},
    requestedBy: 'admin',
    createdAt: '2026-07-25T01:00:00.000Z',
    startedAt: '2026-07-25T01:00:00.000Z',
    updatedAt: '2026-07-25T01:00:00.000Z',
});

const createHarness = (
    operation: GatewayOperationRecord,
    failStart = false,
    failStop = false,
    processesPresent = true,
    missingOnDelete = false,
    workspaceManager?: GitWorkspaceManager,
    startGate?: Promise<void>,
    options: {
        profile?: GatewayProfileRecord;
        profiles?: GatewayProfileRecord[];
        reservedToStart?: GatewayProfileRecord[];
        now?: () => Date;
        cancelGame?: GatewayOrchestratorOptions['cancelGame'];
        frontendServeMode?: 'static';
        frontendArtifactRoot?: string;
        activeOperationProfileNames?: string[];
    } = {}
) => {
    const harnessProfile = options.profile ?? profile;
    let nextOperation: GatewayOperationRecord | null = operation;
    const statuses: string[] = [];
    const completions: GatewayOperationStatus[] = [];
    const completionFields: Array<{ resolvedCommitSha?: string | null; error?: string | null } | undefined> = [];
    const started: ProcessDefinition[] = [];
    const stopped: string[] = [];
    const deleted: string[] = [];
    const buildStatuses: string[] = [];
    const logs: Array<{ phase: string; message: string; level: string }> = [];

    const repository: GatewayProfileRepository = {
        listProfiles: async () => options.profiles ?? [harnessProfile],
        getProfile: async () => harnessProfile,
        upsertProfile: async () => harnessProfile,
        updateCurrentScenario: async () => harnessProfile,
        updateStatus: async (_profileName, status) => {
            statuses.push(status);
            return { ...harnessProfile, status };
        },
        updateBuildStatus: async (_profileName, status) => {
            buildStatuses.push(status);
            return { ...harnessProfile, buildStatus: status };
        },
        updateMeta: async () => harnessProfile,
        listReservedToStart: async () => options.reservedToStart ?? [],
        findQueuedBuild: async () => null,
        updateLastError: async () => {},
        updateWorkspaceUsage: async () => {},
        clearWorkspaceUsage: async () => {},
        listOperations: async () => [],
        listActiveOperationProfileNames: async () =>
            options.activeOperationProfileNames ?? [harnessProfile.profileName],
        getOperation: async () => operation,
        listOperationLogs: async () => [],
        appendOperationLog: async (operationId, input) => {
            logs.push(input);
            return {
                cursor: String(logs.length),
                operationId,
                createdAt: '2026-08-11T00:00:00.000Z',
                ...input,
            };
        },
        createOperation: async () => operation,
        claimNextOperation: async () => {
            const result = nextOperation;
            nextOperation = null;
            return result;
        },
        completeOperation: async (_id, status, fields) => {
            completions.push(status);
            completionFields.push(fields);
            return { ...operation, status };
        },
        requeueOperation: async () => ({ ...operation, status: 'QUEUED' }),
        cancelOperation: async () => false,
        retryOperation: async () => null,
        updateProfileForOperation: async (_id, _ownerId, _profileName, patch) => {
            if (patch.status) statuses.push(patch.status);
            return { ...harnessProfile, status: patch.status ?? harnessProfile.status };
        },
    };
    const processManager: ProcessManager = {
        list: async () =>
            processesPresent
                ? [
                      { name: 'sammo:che:2:game-frontend', status: 'online' },
                      { name: 'sammo:che:2:game-api', status: 'online' },
                      { name: 'sammo:che:2:turn-daemon', status: 'online' },
                      { name: 'sammo:che:2:auction-worker', status: 'online' },
                      { name: 'sammo:che:2:battle-sim-worker', status: 'online' },
                      { name: 'sammo:che:2:tournament-worker', status: 'online' },
                  ]
                : [],
        start: async (definition) => {
            await startGate;
            if (failStart && started.length === 2) {
                throw new Error('pm2 unavailable');
            }
            started.push(definition);
        },
        stop: async (name) => {
            stopped.push(name);
            if (failStop) {
                throw new Error('pm2 stop failed');
            }
        },
        delete: async (name) => {
            deleted.push(name);
            if (missingOnDelete) {
                throw new Error('process or namespace not found');
            }
            if (failStop) {
                throw new Error('pm2 delete failed');
            }
        },
    };
    const orchestrator = new GatewayOrchestrator({
        repository,
        processManager,
        buildRunner: {
            run: async () => ({ ok: true, exitCode: 0, output: '' }),
        },
        workspaceManager:
            workspaceManager ??
            new GitWorkspaceManager({
                repoRoot: '/tmp/not-used',
                worktreeRoot: '/tmp/not-used-worktrees',
            }),
        processConfig: {
            workspaceRoot: '/srv/sammo',
            redisKeyPrefix: 'sammo:test',
            gameTokenSecret: 'test-secret',
            gatewayInternalApiUrl: 'http://127.0.0.1:13000',
            frontendServeMode: options.frontendServeMode,
            frontendArtifactRoot: options.frontendArtifactRoot,
            baseEnv: { DATABASE_URL: 'postgresql://test:test@127.0.0.1:15432/test' },
        },
        reconcileIntervalMs: 60_000,
        scheduleIntervalMs: 60_000,
        buildIntervalMs: 60_000,
        adminActionIntervalMs: 60_000,
        now: options.now,
        cancelGame: options.cancelGame,
    });

    return { orchestrator, statuses, buildStatuses, completions, completionFields, started, stopped, deleted, logs };
};

describe('GatewayOrchestrator first-class operations', () => {
    it('stops runtime, settles once, and seals a cancelled profile', async () => {
        const operation: GatewayOperationRecord = {
            id: '88888888-8888-4888-8888-888888888888',
            profileName: profile.profileName,
            type: 'CANCEL_GAME',
            status: 'RUNNING',
            sourceMode: 'COMMIT',
            sourceRef: profile.buildCommitSha,
            resolvedCommitSha: profile.buildCommitSha,
            payload: {
                historyMode: 'RETAIN_ABANDONED',
                generalMode: 'RETAIN',
                earnedPointRetentionPercent: 40,
            },
            reason: '잘못 연 게임 취소',
            requestedBy: 'admin',
            createdAt: '2026-08-18T00:00:00.000Z',
            startedAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:00.000Z',
        };
        const workspaceManager = {
            resolveCommit: async () => profile.buildCommitSha!,
            prepare: async () => ({ root: process.cwd(), needsInstall: false }),
            remove: async () => {},
        } as unknown as GitWorkspaceManager;
        const settlementRequests: Array<Record<string, unknown>> = [];
        const cancellationProfile = { ...profile, status: 'RUNNING' as const };
        const cancelGame: NonNullable<GatewayOrchestratorOptions['cancelGame']> = async (request) => {
            settlementRequests.push(request as unknown as Record<string, unknown>);
            return {
                cancellationId: operation.id,
                serverId: 'che_260818_fixture',
                originalSeason: 7,
                participantCount: 2,
                preservedGeneralCount: 2,
                historyMode: 'RETAIN_ABANDONED',
                generalMode: 'RETAIN',
                earnedPointRetentionPercent: 40,
                alreadyApplied: false,
                settlements: {},
            };
        };
        const harness = createHarness(operation, false, false, true, false, workspaceManager, undefined, {
            profile: cancellationProfile,
            cancelGame,
        });

        await harness.orchestrator.runOperationsNow();

        expect(settlementRequests).toHaveLength(1);
        expect(settlementRequests[0]).toMatchObject({
            cancellationId: operation.id,
            cancelledBy: 'admin',
            reason: '잘못 연 게임 취소',
            historyMode: 'RETAIN_ABANDONED',
            generalMode: 'RETAIN',
            earnedPointRetentionPercent: 40,
        });
        expect(harness.statuses).toEqual(['STOPPED', 'CANCELLED']);
        expect(harness.stopped).toHaveLength(6);
        expect(harness.completions).toEqual(['SUCCEEDED']);
        expect(harness.logs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ phase: 'settlement' }),
                expect.objectContaining({ phase: 'publish', message: expect.stringContaining('CANCELLED') }),
            ])
        );
    });

    it('does not let a stale START operation reopen a cancelled profile', async () => {
        const cancelledProfile = { ...profile, status: 'CANCELLED' as const };
        const operation = buildOperation('START');
        const harness = createHarness(operation, false, false, true, false, undefined, undefined, {
            profile: cancelledProfile,
        });

        await harness.orchestrator.runOperationsNow();

        expect(harness.started).toEqual([]);
        expect(harness.completions).toEqual(['FAILED']);
        expect(harness.completionFields[0]?.error).toContain('CANCELLED');
    });

    it('does not reconcile a profile while a durable operation is active', async () => {
        const harness = createHarness(buildOperation('START'));

        await harness.orchestrator.reconcileNow();

        expect(harness.started).toEqual([]);
        expect(harness.stopped).toEqual([]);
        expect(harness.deleted).toEqual([]);
    });

    it('opens a prepared reserved profile without rebuilding it again', async () => {
        const now = new Date('2030-01-01T01:00:00.000Z');
        const reservedProfile: GatewayProfileRecord = {
            ...profile,
            status: 'RESERVED',
            currentScenario: '1010',
            scenario: '1010',
            buildStatus: 'SUCCEEDED',
            buildWorkspace: '/srv/sammo/worktrees/0123456789abcdef',
            preopenAt: now.toISOString(),
            openAt: '2030-01-01T02:00:00.000Z',
        };
        const harness = createHarness(buildOperation('START'), false, false, false, false, undefined, undefined, {
            profile: reservedProfile,
            profiles: [],
            reservedToStart: [reservedProfile],
            now: () => now,
        });

        await harness.orchestrator.runScheduleNow();

        expect(harness.statuses).toEqual(['PREOPEN']);
        expect(harness.buildStatuses).toEqual([]);
    });

    it('starts turns when a prepared reserved profile is handled after formal open', async () => {
        const now = new Date('2030-01-01T02:00:00.000Z');
        const reservedProfile: GatewayProfileRecord = {
            ...profile,
            status: 'RESERVED',
            currentScenario: '1010',
            scenario: '1010',
            buildStatus: 'SUCCEEDED',
            buildWorkspace: '/srv/sammo/worktrees/0123456789abcdef',
            preopenAt: '2030-01-01T01:00:00.000Z',
            openAt: now.toISOString(),
        };
        const harness = createHarness(buildOperation('START'), false, false, false, false, undefined, undefined, {
            profile: reservedProfile,
            profiles: [],
            reservedToStart: [reservedProfile],
            now: () => now,
        });

        await harness.orchestrator.runScheduleNow();

        expect(harness.statuses).toEqual(['RUNNING']);
        expect(harness.buildStatuses).toEqual([]);
    });

    it('retains the legacy build queue for an unprepared reserved profile', async () => {
        const now = new Date('2030-01-01T01:00:00.000Z');
        const reservedProfile: GatewayProfileRecord = {
            ...profile,
            status: 'RESERVED',
            currentScenario: null,
            scenario: 'default',
            buildStatus: 'IDLE',
            buildWorkspace: undefined,
            preopenAt: now.toISOString(),
            openAt: '2030-01-01T02:00:00.000Z',
        };
        const harness = createHarness(buildOperation('START'), false, false, false, false, undefined, undefined, {
            profile: reservedProfile,
            profiles: [],
            reservedToStart: [reservedProfile],
            now: () => now,
        });

        await harness.orchestrator.runScheduleNow();

        expect(harness.statuses).toEqual([]);
        expect(harness.buildStatuses).toEqual(['QUEUED']);
    });

    it('starts every profile process and records success', async () => {
        const harness = createHarness(buildOperation('START'));

        await harness.orchestrator.runOperationsNow();

        expect(harness.statuses).toEqual(['RUNNING']);
        expect(harness.started.map((definition) => definition.name)).toEqual([
            'sammo:che:2:game-frontend',
            'sammo:che:2:game-api',
            'sammo:che:2:turn-daemon',
            'sammo:che:2:auction-worker',
            'sammo:che:2:battle-sim-worker',
            'sammo:che:2:tournament-worker',
        ]);
        expect(harness.deleted).toEqual([
            'sammo:che:2:game-frontend',
            'sammo:che:2:game-api',
            'sammo:che:2:turn-daemon',
            'sammo:che:2:auction-worker',
            'sammo:che:2:battle-sim-worker',
            'sammo:che:2:tournament-worker',
        ]);
        expect(harness.completions).toEqual(['SUCCEEDED']);
    });

    it('removes a legacy Vite process while publishing the first static artifact', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-static-cutover-'));
        temporaryDirectories.push(workspace);
        await fs.mkdir(path.join(workspace, '.release-dist', 'che_2', 'game-frontend'), { recursive: true });
        await fs.writeFile(
            path.join(workspace, '.release-dist', 'che_2', 'game-frontend', 'index.html'),
            '<!doctype html><title>static cutover</title>'
        );
        const artifactRoot = path.join(workspace, 'artifacts');
        const staticProfile = { ...profile, status: 'RUNNING' as const, buildWorkspace: workspace };
        const harness = createHarness(buildOperation('START'), false, false, true, false, undefined, undefined, {
            profile: staticProfile,
            frontendServeMode: 'static',
            frontendArtifactRoot: artifactRoot,
            activeOperationProfileNames: [],
        });

        await harness.orchestrator.reconcileNow();

        expect(harness.deleted).toContain('sammo:che:2:game-frontend');
        expect(harness.started.map((definition) => definition.name)).toEqual([
            'sammo:che:2:game-api',
            'sammo:che:2:turn-daemon',
            'sammo:che:2:auction-worker',
            'sammo:che:2:battle-sim-worker',
            'sammo:che:2:tournament-worker',
        ]);
        expect(await fs.readFile(path.join(artifactRoot, 'che', 'current', 'index.html'), 'utf8')).toContain(
            'static cutover'
        );
        expect(harness.completions).toEqual([]);
    });

    it('keeps legacy processes untouched when the first static artifact cannot be staged', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-static-cutover-missing-'));
        temporaryDirectories.push(workspace);
        const harness = createHarness(buildOperation('START'), false, false, true, false, undefined, undefined, {
            profile: { ...profile, status: 'RUNNING', buildWorkspace: workspace },
            frontendServeMode: 'static',
            frontendArtifactRoot: path.join(workspace, 'artifacts'),
            activeOperationProfileNames: [],
        });

        await harness.orchestrator.reconcileNow();

        expect(harness.started).toEqual([]);
        expect(harness.deleted).toEqual([]);
        expect(harness.completions).toEqual([]);
    });

    it('stops every profile process and records success', async () => {
        const harness = createHarness(buildOperation('STOP'));

        await harness.orchestrator.runOperationsNow();

        expect(harness.statuses).toEqual(['STOPPED']);
        expect(harness.stopped).toEqual([
            'sammo:che:2:game-frontend',
            'sammo:che:2:game-api',
            'sammo:che:2:turn-daemon',
            'sammo:che:2:auction-worker',
            'sammo:che:2:battle-sim-worker',
            'sammo:che:2:tournament-worker',
        ]);
        expect(harness.deleted).toEqual([
            'sammo:che:2:game-frontend',
            'sammo:che:2:game-api',
            'sammo:che:2:turn-daemon',
            'sammo:che:2:auction-worker',
            'sammo:che:2:battle-sim-worker',
            'sammo:che:2:tournament-worker',
        ]);
        expect(harness.completions).toEqual(['SUCCEEDED']);
    });

    it('treats an already stopped profile as a successful idempotent stop', async () => {
        const harness = createHarness(buildOperation('STOP'), false, false, false);

        await harness.orchestrator.runOperationsNow();

        expect(harness.statuses).toEqual(['STOPPED']);
        expect(harness.stopped).toEqual([]);
        expect(harness.deleted).toEqual([]);
        expect(harness.completions).toEqual(['SUCCEEDED']);
    });

    it('treats a process removed concurrently as a successful stop', async () => {
        const harness = createHarness(buildOperation('STOP'), false, false, true, true);

        await harness.orchestrator.runOperationsNow();

        expect(harness.deleted).toEqual([
            'sammo:che:2:game-frontend',
            'sammo:che:2:game-api',
            'sammo:che:2:turn-daemon',
            'sammo:che:2:auction-worker',
            'sammo:che:2:battle-sim-worker',
            'sammo:che:2:tournament-worker',
        ]);
        expect(harness.completions).toEqual(['SUCCEEDED']);
    });

    it('records a failed start instead of reporting a false success', async () => {
        const harness = createHarness(buildOperation('START'), true);

        await harness.orchestrator.runOperationsNow();

        expect(harness.completions).toEqual(['FAILED']);
        expect(harness.deleted).toEqual([
            'sammo:che:2:game-frontend',
            'sammo:che:2:game-api',
            'sammo:che:2:turn-daemon',
            'sammo:che:2:auction-worker',
            'sammo:che:2:battle-sim-worker',
            'sammo:che:2:tournament-worker',
            'sammo:che:2:turn-daemon',
            'sammo:che:2:game-api',
            'sammo:che:2:game-frontend',
        ]);
    });

    it('attempts to stop every role before reporting a partial PM2 failure', async () => {
        const harness = createHarness(buildOperation('STOP'), false, true);

        await harness.orchestrator.runOperationsNow();

        expect(harness.stopped).toEqual([
            'sammo:che:2:game-frontend',
            'sammo:che:2:game-api',
            'sammo:che:2:turn-daemon',
            'sammo:che:2:auction-worker',
            'sammo:che:2:battle-sim-worker',
            'sammo:che:2:tournament-worker',
        ]);
        expect(harness.deleted).toEqual([
            'sammo:che:2:game-frontend',
            'sammo:che:2:game-api',
            'sammo:che:2:turn-daemon',
            'sammo:che:2:auction-worker',
            'sammo:che:2:battle-sim-worker',
            'sammo:che:2:tournament-worker',
        ]);
        expect(harness.completions).toEqual(['FAILED']);
    });

    it('records the resolved commit even when reset workspace preparation fails', async () => {
        const resolvedCommitSha = 'abcdef0123456789abcdef0123456789abcdef01';
        const resetOperation: GatewayOperationRecord = {
            id: '33333333-3333-4333-8333-333333333333',
            profileName: profile.profileName,
            type: 'RESET',
            status: 'RUNNING',
            sourceMode: 'COMMIT',
            sourceRef: 'requested-ref',
            payload: { install: { scenarioId: 1010, turnTermMinutes: 60 } },
            requestedBy: 'admin',
            createdAt: '2026-07-31T00:00:00.000Z',
            startedAt: '2026-07-31T00:00:00.000Z',
            updatedAt: '2026-07-31T00:00:00.000Z',
        };
        const workspaceManager = {
            resolveCommit: async () => resolvedCommitSha,
            prepare: async () => {
                throw new Error('injected workspace preparation failure');
            },
            remove: async () => {},
        } as unknown as GitWorkspaceManager;
        const harness = createHarness(resetOperation, false, false, true, false, workspaceManager);

        await harness.orchestrator.runOperationsNow();

        expect(harness.completions).toEqual(['FAILED']);
        expect(harness.completionFields).toEqual([
            {
                resolvedCommitSha,
                error: 'injected workspace preparation failure',
            },
        ]);
    });

    it('drains an in-flight operation before shutdown completes', async () => {
        let releaseStart: (() => void) | undefined;
        const startGate = new Promise<void>((resolve) => {
            releaseStart = resolve;
        });
        const harness = createHarness(buildOperation('START'), false, false, true, false, undefined, startGate);
        harness.orchestrator.start();
        await new Promise<void>((resolve) => setImmediate(resolve));

        let stopped = false;
        const stopPromise = harness.orchestrator.stop().then(() => {
            stopped = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(stopped).toBe(false);

        releaseStart?.();
        await stopPromise;
        expect(harness.completions).toEqual(['SUCCEEDED']);
    });
});
