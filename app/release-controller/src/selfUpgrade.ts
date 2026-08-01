import path from 'node:path';

import {
    assertReleaseComponents,
    type BuildCommand,
    type BuildRunner,
    type GitWorkspaceManager,
    type ProcessDefinition,
    type ProcessManager,
    readReleaseManifest,
} from '@sammo-ts/gateway-api';

import type { ReleaseControllerConfig } from './config.js';
import { buildGatewayMigrationCommand } from './releaseController.js';

const CONTROLLER_PROCESS_NAME = 'sammo:release-controller';

export const buildReleaseControllerCommands = (
    workspaceRoot: string,
    needsInstall: boolean,
    config: ReleaseControllerConfig
): BuildCommand[] => {
    const env = config.baseEnv;
    return [
        ...(needsInstall ? [{ command: 'pnpm', args: ['install', '--frozen-lockfile'], cwd: workspaceRoot, env }] : []),
        { command: 'pnpm', args: ['--filter', '@sammo-ts/common', 'build'], cwd: workspaceRoot, env },
        { command: 'pnpm', args: ['--filter', '@sammo-ts/infra', 'prisma:generate'], cwd: workspaceRoot, env },
        { command: 'pnpm', args: ['--filter', '@sammo-ts/infra', 'build'], cwd: workspaceRoot, env },
        { command: 'pnpm', args: ['--filter', '@sammo-ts/logic', 'build'], cwd: workspaceRoot, env },
        { command: 'pnpm', args: ['--filter', '@sammo-ts/game-engine', 'build'], cwd: workspaceRoot, env },
        { command: 'pnpm', args: ['--filter', '@sammo-ts/gateway-api', 'build'], cwd: workspaceRoot, env },
        { command: 'pnpm', args: ['--filter', '@sammo-ts/release-controller', 'build'], cwd: workspaceRoot, env },
    ];
};

export const buildReleaseControllerDefinition = (
    workspaceRoot: string,
    config: ReleaseControllerConfig
): ProcessDefinition => ({
    name: CONTROLLER_PROCESS_NAME,
    script: path.join(workspaceRoot, 'app', 'release-controller', 'dist', 'index.js'),
    cwd: path.join(workspaceRoot, 'app', 'release-controller'),
    args: ['daemon'],
    env: {
        ...config.baseEnv,
        GATEWAY_DATABASE_URL: config.gatewayDatabaseUrl,
        GATEWAY_DB_SCHEMA: config.gatewayDbSchema,
        RELEASE_CONTROLLER_WORKSPACE_ROOT: workspaceRoot,
        RELEASE_CONTROLLER_WORKTREE_ROOT: config.worktreeRoot,
    },
});

const workspaceFromControllerCwd = (cwd: string | undefined, fallback: string): string =>
    cwd ? path.resolve(cwd, '..', '..') : fallback;

export const upgradeReleaseController = async (options: {
    sourceMode: 'BRANCH' | 'COMMIT';
    sourceRef: string;
    workspaceManager: GitWorkspaceManager;
    buildRunner: BuildRunner;
    processManager: ProcessManager;
    config: ReleaseControllerConfig;
    readinessTimeoutMs?: number;
}): Promise<{ commitSha: string; workspace: string }> => {
    const commitSha = await options.workspaceManager.resolveCommit(options.sourceMode, options.sourceRef);
    const workspace = await options.workspaceManager.prepare(commitSha);
    const manifest = await readReleaseManifest(workspace.root);
    assertReleaseComponents(manifest, ['release-controller']);
    const build = await options.buildRunner.run(
        buildReleaseControllerCommands(workspace.root, workspace.needsInstall, options.config)
    );
    if (!build.ok) throw new Error(`Release controller build failed: ${build.output.slice(-4000)}`);
    const migration = await options.buildRunner.run([buildGatewayMigrationCommand(workspace.root, options.config)]);
    if (!migration.ok) throw new Error(`Gateway migration failed: ${migration.output.slice(-4000)}`);

    const existing = (await options.processManager.list()).find((process) => process.name === CONTROLLER_PROCESS_NAME);
    const previousDefinition = buildReleaseControllerDefinition(
        workspaceFromControllerCwd(existing?.cwd, options.config.workspaceRoot),
        options.config
    );
    if (existing) {
        try {
            await options.processManager.stop(CONTROLLER_PROCESS_NAME);
        } finally {
            await options.processManager.delete(CONTROLLER_PROCESS_NAME);
        }
    }
    try {
        await options.processManager.start(buildReleaseControllerDefinition(workspace.root, options.config));
        const deadline = Date.now() + (options.readinessTimeoutMs ?? options.config.readinessTimeoutMs);
        while (Date.now() < deadline) {
            const active = (await options.processManager.list()).find(
                (process) => process.name === CONTROLLER_PROCESS_NAME && process.status.toLowerCase() === 'online'
            );
            if (active) return { commitSha, workspace: workspace.root };
            await new Promise<void>((resolve) => setTimeout(resolve, 250));
        }
        throw new Error('Release controller did not become online before the timeout.');
    } catch (error) {
        try {
            await options.processManager.delete(CONTROLLER_PROCESS_NAME);
        } catch {
            // The failed new process may already be absent.
        }
        if (existing) await options.processManager.start(previousDefinition);
        throw error;
    }
};
