import { describe, expect, it } from 'vitest';

import { GatewayOrchestrator } from '../src/orchestrator/gatewayOrchestrator.js';
import type { ProcessManager } from '../src/orchestrator/processManager.js';
import type { GatewayProfileRecord, GatewayProfileRepository } from '../src/orchestrator/profileRepository.js';
import type { GitWorkspaceManager } from '../src/orchestrator/workspaceManager.js';

const oldUsage = '2025-01-01T00:00:00.000Z';

const makeProfile = (
    profileName: string,
    workspace: string,
    overrides: Partial<GatewayProfileRecord> = {}
): GatewayProfileRecord => ({
    profileName,
    profile: profileName.split(':')[0] ?? 'che',
    scenario: profileName.split(':')[1] ?? 'default',
    apiPort: 15_003,
    status: 'RUNNING',
    buildStatus: 'SUCCEEDED',
    buildCommitSha: '0123456789abcdef0123456789abcdef01234567',
    buildWorkspace: workspace,
    buildLastUsedAt: oldUsage,
    meta: {},
    createdAt: oldUsage,
    updatedAt: oldUsage,
    ...overrides,
});

const createHarness = (
    profiles: GatewayProfileRecord[],
    processes: Awaited<ReturnType<ProcessManager['list']>>,
    workspaceExists = true
) => {
    const removeCalls: string[] = [];
    const clearedProfiles: string[][] = [];

    const repository = {
        listProfiles: async () => profiles,
        clearWorkspaceUsage: async (profileNames: string[]) => {
            clearedProfiles.push(profileNames);
        },
    } as unknown as GatewayProfileRepository;
    const processManager: ProcessManager = {
        list: async () => processes,
        start: async () => {},
        stop: async () => {},
        delete: async () => {},
    };
    const workspaceManager = {
        remove: async (workspace: string) => {
            removeCalls.push(workspace);
            return workspaceExists;
        },
    } as unknown as GitWorkspaceManager;
    const orchestrator = new GatewayOrchestrator({
        repository,
        processManager,
        buildRunner: { run: async () => ({ ok: true, exitCode: 0, output: '' }) },
        workspaceManager,
        processConfig: {
            workspaceRoot: '/srv/sammo',
            redisKeyPrefix: 'sammo:test',
            gameTokenSecret: 'test-secret',
        },
        reconcileIntervalMs: 60_000,
        scheduleIntervalMs: 60_000,
        buildIntervalMs: 60_000,
        adminActionIntervalMs: 60_000,
        now: () => new Date('2026-07-30T00:00:00.000Z'),
    });

    return { orchestrator, removeCalls, clearedProfiles };
};

describe('GatewayOrchestrator workspace cleanup', () => {
    it('skips a workspace referenced by any active process cwd', async () => {
        const workspace = '/srv/sammo/worktrees/active';
        const harness = createHarness(
            [makeProfile('che:default', workspace)],
            [
                {
                    name: 'sammo:che:default:frontend',
                    status: 'online',
                    cwd: `${workspace}/app/game-frontend`,
                },
            ]
        );

        await expect(harness.orchestrator.cleanupStaleWorkspaces()).resolves.toEqual({
            removed: [],
            skipped: [workspace],
        });
        expect(harness.removeCalls).toEqual([]);
        expect(harness.clearedProfiles).toEqual([]);
    });

    it('skips a workspace when only one profile process is active and cwd metadata is absent', async () => {
        const workspace = '/srv/sammo/worktrees/partial';
        const harness = createHarness(
            [makeProfile('che:default', workspace)],
            [{ name: 'sammo:che:default:tournament-worker', status: 'launching' }]
        );

        await expect(harness.orchestrator.cleanupStaleWorkspaces()).resolves.toEqual({
            removed: [],
            skipped: [workspace],
        });
        expect(harness.removeCalls).toEqual([]);
    });

    it('skips a workspace referenced only by an active process script', async () => {
        const workspace = '/srv/sammo/worktrees/script-reference';
        const harness = createHarness(
            [makeProfile('che:default', workspace)],
            [
                {
                    name: 'unregistered-worker-name',
                    status: 'online',
                    script: `${workspace}/app/game-api/dist/index.js`,
                },
            ]
        );

        await expect(harness.orchestrator.cleanupStaleWorkspaces()).resolves.toEqual({
            removed: [],
            skipped: [workspace],
        });
        expect(harness.removeCalls).toEqual([]);
    });

    it('protects a shared workspace when a process for either profile is active', async () => {
        const workspace = '/srv/sammo/worktrees/shared';
        const harness = createHarness(
            [makeProfile('che:default', workspace), makeProfile('hwe:default', workspace)],
            [{ name: 'sammo:hwe:default:game-api', status: 'stopping' }]
        );

        await expect(harness.orchestrator.cleanupStaleWorkspaces()).resolves.toEqual({
            removed: [],
            skipped: [workspace],
        });
        expect(harness.removeCalls).toEqual([]);
    });

    it('removes an old unreferenced workspace and clears every profile reference', async () => {
        const workspace = '/srv/sammo/worktrees/stale';
        const harness = createHarness(
            [makeProfile('che:default', workspace), makeProfile('hwe:default', workspace)],
            [{ name: 'sammo:che:default:game-api', status: 'stopped', cwd: `${workspace}/app/game-api` }]
        );

        await expect(harness.orchestrator.cleanupStaleWorkspaces()).resolves.toEqual({
            removed: [workspace],
            skipped: [],
        });
        expect(harness.removeCalls).toEqual([workspace]);
        expect(harness.clearedProfiles).toEqual([['che:default', 'hwe:default']]);
    });

    it('does not treat a sibling path with the same prefix as a workspace reference', async () => {
        const workspace = '/srv/sammo/worktrees/commit-a';
        const harness = createHarness(
            [makeProfile('che:default', workspace)],
            [
                {
                    name: 'unregistered-worker-name',
                    status: 'online',
                    cwd: '/srv/sammo/worktrees/commit-a-old/app/game-api',
                },
            ]
        );

        await expect(harness.orchestrator.cleanupStaleWorkspaces()).resolves.toEqual({
            removed: [workspace],
            skipped: [],
        });
        expect(harness.removeCalls).toEqual([workspace]);
    });

    it('clears a stale database reference when the workspace is already missing', async () => {
        const workspace = '/srv/sammo/worktrees/missing';
        const harness = createHarness([makeProfile('che:default', workspace)], [], false);

        await expect(harness.orchestrator.cleanupStaleWorkspaces()).resolves.toEqual({
            removed: [workspace],
            skipped: [],
        });
        expect(harness.removeCalls).toEqual([workspace]);
        expect(harness.clearedProfiles).toEqual([['che:default']]);
    });
});
