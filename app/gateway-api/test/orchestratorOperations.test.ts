import { describe, expect, it } from 'vitest';

import { GatewayOrchestrator } from '../src/orchestrator/gatewayOrchestrator.js';
import type { ProcessDefinition, ProcessManager } from '../src/orchestrator/processManager.js';
import type {
    GatewayOperationRecord,
    GatewayOperationStatus,
    GatewayProfileRecord,
    GatewayProfileRepository,
} from '../src/orchestrator/profileRepository.js';
import { GitWorkspaceManager } from '../src/orchestrator/workspaceManager.js';

const profile: GatewayProfileRecord = {
    profileName: 'che:2',
    profile: 'che',
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
    missingOnDelete = false
) => {
    let nextOperation: GatewayOperationRecord | null = operation;
    const statuses: string[] = [];
    const completions: GatewayOperationStatus[] = [];
    const started: ProcessDefinition[] = [];
    const stopped: string[] = [];
    const deleted: string[] = [];

    const repository: GatewayProfileRepository = {
        listProfiles: async () => [profile],
        getProfile: async () => profile,
        upsertProfile: async () => profile,
        updateScenario: async () => profile,
        updateStatus: async (_profileName, status) => {
            statuses.push(status);
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
        getOperation: async () => operation,
        createOperation: async () => operation,
        claimNextOperation: async () => {
            const result = nextOperation;
            nextOperation = null;
            return result;
        },
        completeOperation: async (_id, status) => {
            completions.push(status);
            return { ...operation, status };
        },
        requeueOperation: async () => ({ ...operation, status: 'QUEUED' }),
        cancelOperation: async () => false,
        retryOperation: async () => null,
    };
    const processManager: ProcessManager = {
        list: async () =>
            processesPresent
                ? [
                      { name: 'sammo:che:2:game-api', status: 'online' },
                      { name: 'sammo:che:2:turn-daemon', status: 'online' },
                  ]
                : [],
        start: async (definition) => {
            if (failStart) {
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
        workspaceManager: new GitWorkspaceManager({
            repoRoot: '/tmp/not-used',
            worktreeRoot: '/tmp/not-used-worktrees',
        }),
        processConfig: {
            workspaceRoot: '/srv/sammo',
            redisKeyPrefix: 'sammo:test',
            gameTokenSecret: 'test-secret',
        },
        reconcileIntervalMs: 60_000,
        scheduleIntervalMs: 60_000,
        buildIntervalMs: 60_000,
        adminActionIntervalMs: 60_000,
    });

    return { orchestrator, statuses, completions, started, stopped, deleted };
};

describe('GatewayOrchestrator first-class operations', () => {
    it('starts both profile processes and records success', async () => {
        const harness = createHarness(buildOperation('START'));

        await harness.orchestrator.runOperationsNow();

        expect(harness.statuses).toEqual(['RUNNING']);
        expect(harness.started.map((definition) => definition.name)).toEqual([
            'sammo:che:2:game-api',
            'sammo:che:2:turn-daemon',
        ]);
        expect(harness.completions).toEqual(['SUCCEEDED']);
    });

    it('stops both profile processes and records success', async () => {
        const harness = createHarness(buildOperation('STOP'));

        await harness.orchestrator.runOperationsNow();

        expect(harness.statuses).toEqual(['STOPPED']);
        expect(harness.stopped).toEqual(['sammo:che:2:game-api', 'sammo:che:2:turn-daemon']);
        expect(harness.deleted).toEqual(['sammo:che:2:game-api', 'sammo:che:2:turn-daemon']);
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

        expect(harness.deleted).toEqual(['sammo:che:2:game-api', 'sammo:che:2:turn-daemon']);
        expect(harness.completions).toEqual(['SUCCEEDED']);
    });

    it('records a failed start instead of reporting a false success', async () => {
        const harness = createHarness(buildOperation('START'), true);

        await harness.orchestrator.runOperationsNow();

        expect(harness.completions).toEqual(['FAILED']);
    });

    it('attempts to stop both roles before reporting a partial PM2 failure', async () => {
        const harness = createHarness(buildOperation('STOP'), false, true);

        await harness.orchestrator.runOperationsNow();

        expect(harness.stopped).toEqual(['sammo:che:2:game-api', 'sammo:che:2:turn-daemon']);
        expect(harness.deleted).toEqual(['sammo:che:2:game-api', 'sammo:che:2:turn-daemon']);
        expect(harness.completions).toEqual(['FAILED']);
    });
});
