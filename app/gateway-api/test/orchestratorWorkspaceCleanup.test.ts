import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { GatewayOrchestrator } from '../src/orchestrator/gatewayOrchestrator.js';
import { FrontendArtifactManager } from '../src/orchestrator/frontendArtifactManager.js';
import type { ProcessManager } from '../src/orchestrator/processManager.js';
import type { GatewayProfileRecord, GatewayProfileRepository } from '../src/orchestrator/profileRepository.js';
import {
    DEFAULT_MANAGED_WORKSPACE_KEEP_NEWEST,
    DEFAULT_MANAGED_WORKSPACE_RETENTION_MS,
    type GitWorkspaceManager,
    type ManagedWorkspaceCleanupOptions,
} from '../src/orchestrator/workspaceManager.js';

const COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const oldUsage = '2025-01-01T00:00:00.000Z';
const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

const makeProfile = (
    profileName: string,
    workspace: string | undefined,
    overrides: Partial<GatewayProfileRecord> = {}
): GatewayProfileRecord => ({
    profileName,
    profile: profileName.split(':')[0] ?? 'che',
    instanceKey: profileName.split(':')[1] ?? 'default',
    currentScenario: null,
    scenario: profileName.split(':')[1] ?? 'default',
    apiPort: 15_003,
    status: 'RUNNING',
    buildStatus: 'SUCCEEDED',
    buildCommitSha: COMMIT_SHA,
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
    managedPaths: string[],
    frontendArtifactRoot?: string
) => {
    const cleanupCalls: ManagedWorkspaceCleanupOptions[] = [];
    const repository = {
        listProfiles: async () => profiles,
        listOperations: async () => [],
    } as unknown as GatewayProfileRepository;
    const processManager: ProcessManager = {
        list: async () => processes,
        start: async () => {},
        stop: async () => {},
        delete: async () => {},
    };
    const workspaceManager = {
        listManagedWorkspaces: async () =>
            managedPaths.map((root) => ({ root, commitSha: path.basename(root), lastUsedAt: new Date(oldUsage) })),
        workspacePathForCommit: (commitSha: string) => `/srv/sammo/worktrees/${commitSha}`,
        cleanup: async (options: ManagedWorkspaceCleanupOptions) => {
            cleanupCalls.push(options);
            const protectedPaths = new Set(options.protectedPaths);
            return {
                removed: managedPaths.filter((workspace) => !protectedPaths.has(workspace)),
                skipped: managedPaths.filter((workspace) => protectedPaths.has(workspace)),
            };
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
            gatewayInternalApiUrl: 'http://127.0.0.1:13000',
            ...(frontendArtifactRoot ? { frontendServeMode: 'static' as const, frontendArtifactRoot } : {}),
        },
        reconcileIntervalMs: 60_000,
        scheduleIntervalMs: 60_000,
        buildIntervalMs: 60_000,
        adminActionIntervalMs: 60_000,
        now: () => new Date('2026-08-23T00:00:00.000Z'),
    });
    return { orchestrator, cleanupCalls };
};

describe('GatewayOrchestrator workspace cleanup', () => {
    it('always protects every workspace currently selected by a profile', async () => {
        const current = '/srv/sammo/worktrees/current';
        const stale = '/srv/sammo/worktrees/stale';
        const harness = createHarness([makeProfile('che:default', current)], [], [current, stale]);

        await expect(harness.orchestrator.cleanupStaleWorkspaces()).resolves.toEqual({
            removed: [stale],
            skipped: [current],
        });
        expect(harness.cleanupCalls[0]).toMatchObject({
            retentionMs: DEFAULT_MANAGED_WORKSPACE_RETENTION_MS,
            keepNewest: DEFAULT_MANAGED_WORKSPACE_KEEP_NEWEST,
        });
    });

    it('protects the commit target of queued and running builds before the profile reference changes', async () => {
        const target = `/srv/sammo/worktrees/${COMMIT_SHA}`;
        const harness = createHarness([makeProfile('che:default', undefined, { buildStatus: 'QUEUED' })], [], [target]);

        await expect(harness.orchestrator.cleanupStaleWorkspaces()).resolves.toEqual({
            removed: [],
            skipped: [target],
        });
    });

    it('protects an otherwise orphaned workspace referenced by any active process cwd or script', async () => {
        const cwdWorkspace = '/srv/sammo/worktrees/cwd-orphan';
        const scriptWorkspace = '/srv/sammo/worktrees/script-orphan';
        const stale = '/srv/sammo/worktrees/stale';
        const harness = createHarness(
            [],
            [
                { name: 'custom-build', status: 'online', cwd: `${cwdWorkspace}/app/game-api` },
                { name: 'custom-worker', status: 'launching', script: `${scriptWorkspace}/dist/index.js` },
                { name: 'stopped-worker', status: 'stopped', cwd: `${stale}/app/game-api` },
            ],
            [cwdWorkspace, scriptWorkspace, stale]
        );

        await expect(harness.orchestrator.cleanupStaleWorkspaces()).resolves.toEqual({
            removed: [stale],
            skipped: [cwdWorkspace, scriptWorkspace],
        });
    });

    it('does not confuse sibling path prefixes with an active workspace reference', async () => {
        const workspace = '/srv/sammo/worktrees/commit-a';
        const harness = createHarness(
            [],
            [{ name: 'custom-worker', status: 'online', cwd: `${workspace}-old/app/game-api` }],
            [workspace]
        );

        await expect(harness.orchestrator.cleanupStaleWorkspaces()).resolves.toEqual({
            removed: [workspace],
            skipped: [],
        });
    });

    it('serializes profile worktree and frontend artifact cleanup under the same managed cycle', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-profile-artifact-cleanup-'));
        temporaryDirectories.push(root);
        const sourceRoot = path.join(root, 'dist');
        const artifactRoot = path.join(root, 'artifacts');
        await fs.mkdir(sourceRoot, { recursive: true });
        const manager = new FrontendArtifactManager(artifactRoot);
        const stage = async (marker: string, commitMarker: string) => {
            await fs.writeFile(path.join(sourceRoot, 'index.html'), `<div>${marker}</div>`);
            return manager.stage({
                frontendKey: 'che',
                sourceRoot,
                commitSha: commitMarker.repeat(40),
            });
        };
        const active = await stage('active', '1');
        await manager.activate('che', active.releaseId);
        const cacheOne = await stage('cache-one', '2');
        const cacheTwo = await stage('cache-two', '3');
        const stale = await stage('stale', '4');
        const now = new Date('2026-08-23T00:00:00.000Z');
        const old = new Date(now.getTime() - 72 * 60 * 60 * 1_000);
        for (const artifact of [active, cacheOne, cacheTwo, stale]) {
            await fs.utimes(artifact.releasePath, old, old);
        }
        await fs.utimes(cacheTwo.releasePath, new Date(old.getTime() + 2_000), new Date(old.getTime() + 2_000));
        await fs.utimes(cacheOne.releasePath, new Date(old.getTime() + 1_000), new Date(old.getTime() + 1_000));
        const harness = createHarness(
            [makeProfile('che:default', undefined, { buildCommitSha: active.manifest.commitSha })],
            [],
            [],
            artifactRoot
        );

        const result = await harness.orchestrator.cleanupStaleResources();

        expect(result.workspaces).toEqual({ removed: [], skipped: [] });
        expect(result.artifacts.removed).toEqual([stale.releasePath]);
        expect(result.artifacts.retained).toEqual(
            expect.arrayContaining([active.releasePath, cacheOne.releasePath, cacheTwo.releasePath])
        );
    });
});
