import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
    assertReleaseComponents,
    type BuildCommand,
    type BuildRunner,
    type GatewayReleaseOperationRecord,
    type GatewayReleaseRepository,
    type GatewayReleaseStateRecord,
    type GitWorkspaceManager,
    type ProcessDefinition,
    type ProcessManager,
    readReleaseManifest,
    sanitizeManagedProcessEnv,
} from '@sammo-ts/gateway-api';

import type { ReleaseControllerConfig } from './config.js';

const LEASE_DURATION_MS = 10 * 60_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const PROCESS_NAMES = ['sammo:gateway-api', 'sammo:gateway-frontend', 'sammo:gateway-orchestrator'] as const;

export const buildGatewayReleaseCommands = (
    workspaceRoot: string,
    needsInstall: boolean,
    config: ReleaseControllerConfig
): BuildCommand[] => {
    const env = {
        ...sanitizeManagedProcessEnv(config.baseEnv),
        VITE_APP_BASE_PATH: config.gatewayBasePath,
        VITE_GATEWAY_API_URL: `${config.gatewayBasePath}/api/trpc`,
        VITE_GAME_API_URL_TEMPLATE: '/{profile}/api/trpc',
        VITE_GAME_WEB_URL_TEMPLATE: '/{profile}/',
    };
    return [
        ...(needsInstall ? [{ command: 'pnpm', args: ['install', '--frozen-lockfile'], cwd: workspaceRoot, env }] : []),
        { command: 'pnpm', args: ['--filter', '@sammo-ts/common', 'build'], cwd: workspaceRoot, env },
        { command: 'pnpm', args: ['--filter', '@sammo-ts/infra', 'prisma:generate'], cwd: workspaceRoot, env },
        { command: 'pnpm', args: ['--filter', '@sammo-ts/infra', 'build'], cwd: workspaceRoot, env },
        { command: 'pnpm', args: ['--filter', '@sammo-ts/logic', 'build'], cwd: workspaceRoot, env },
        { command: 'pnpm', args: ['--filter', '@sammo-ts/game-engine', 'build'], cwd: workspaceRoot, env },
        { command: 'pnpm', args: ['--filter', '@sammo-ts/gateway-api', 'build'], cwd: workspaceRoot, env },
        { command: 'pnpm', args: ['--filter', '@sammo-ts/gateway-frontend', 'build'], cwd: workspaceRoot, env },
    ];
};

export const buildGatewayMigrationCommand = (workspaceRoot: string, config: ReleaseControllerConfig): BuildCommand => ({
    command: 'pnpm',
    args: ['--filter', '@sammo-ts/infra', 'prisma:migrate:deploy:gateway'],
    cwd: workspaceRoot,
    env: {
        ...sanitizeManagedProcessEnv(config.baseEnv),
        GATEWAY_DATABASE_URL: config.gatewayDatabaseUrl,
    },
});

export const buildGatewayProcessDefinitions = (
    workspaceRoot: string,
    config: ReleaseControllerConfig
): ProcessDefinition[] => {
    const apiCwd = path.join(workspaceRoot, 'app', 'gateway-api');
    const frontendCwd = path.join(workspaceRoot, 'app', 'gateway-frontend');
    const apiScript = path.join(apiCwd, 'dist', 'index.js');
    const frontendScript = path.join(frontendCwd, 'node_modules', 'vite', 'bin', 'vite.js');
    const env = {
        ...sanitizeManagedProcessEnv(config.baseEnv),
        GATEWAY_API_HOST: '0.0.0.0',
        GATEWAY_API_PORT: String(config.gatewayApiPort),
        GATEWAY_DATABASE_URL: config.gatewayDatabaseUrl,
    };
    return [
        { name: 'sammo:gateway-api', script: apiScript, cwd: apiCwd, env: { ...env, GATEWAY_ROLE: 'api' } },
        {
            name: 'sammo:gateway-frontend',
            script: frontendScript,
            cwd: frontendCwd,
            args: ['preview', '--host', '0.0.0.0', '--port', String(config.gatewayFrontendPort)],
            env,
        },
        {
            name: 'sammo:gateway-orchestrator',
            script: apiScript,
            cwd: apiCwd,
            env: { ...env, GATEWAY_ROLE: 'orchestrator' },
        },
    ];
};

const isMissingProcessError = (error: unknown): boolean =>
    error instanceof Error && /process or namespace not found/i.test(error.message);

export class GatewayReleaseController {
    private readonly ownerId = randomUUID();

    constructor(
        private readonly repository: GatewayReleaseRepository,
        private readonly workspaceManager: GitWorkspaceManager,
        private readonly buildRunner: BuildRunner,
        private readonly processManager: ProcessManager,
        private readonly config: ReleaseControllerConfig,
        private readonly now: () => Date = () => new Date(),
        private readonly fetchImpl: typeof fetch = fetch
    ) {}

    async runOnce(): Promise<GatewayReleaseOperationRecord | null> {
        const operation = await this.repository.claimNextOperation(this.now(), {
            ownerId: this.ownerId,
            durationMs: LEASE_DURATION_MS,
        });
        if (!operation) return null;
        const heartbeat = setInterval(() => {
            void this.repository.renewOperationLease(operation.id, this.ownerId, this.now(), LEASE_DURATION_MS);
        }, HEARTBEAT_INTERVAL_MS);
        let resolvedCommitSha: string | undefined;
        try {
            const state = await this.repository.getState();
            const deploymentState: GatewayReleaseStateRecord = {
                ...state,
                activeCommitSha: state.activeCommitSha ?? (await this.workspaceManager.resolveCommit('COMMIT', 'HEAD')),
                activeWorkspace: state.activeWorkspace ?? this.config.workspaceRoot,
            };
            const sourceMode = operation.sourceMode ?? 'COMMIT';
            const sourceRef = operation.sourceRef ?? state.previousCommitSha;
            if (!sourceRef) throw new Error('Release source is missing.');
            resolvedCommitSha = await this.workspaceManager.resolveCommit(sourceMode, sourceRef);
            if (!(await this.repository.pinOperationResolvedCommit(operation.id, this.ownerId, resolvedCommitSha))) {
                throw new Error('Gateway release lease was lost while pinning the commit.');
            }
            await this.deploy(operation, deploymentState, resolvedCommitSha);
            return await this.repository.completeOperation(
                operation.id,
                'SUCCEEDED',
                { resolvedCommitSha, error: null },
                this.ownerId
            );
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            await this.repository.recordStateError(detail);
            return await this.repository.completeOperation(
                operation.id,
                'FAILED',
                { resolvedCommitSha, error: detail },
                this.ownerId
            );
        } finally {
            clearInterval(heartbeat);
        }
    }

    private async deploy(
        operation: GatewayReleaseOperationRecord,
        state: GatewayReleaseStateRecord,
        commitSha: string
    ): Promise<void> {
        const workspace = await this.workspaceManager.prepare(commitSha);
        const manifest = await readReleaseManifest(workspace.root);
        assertReleaseComponents(manifest, ['gateway-api', 'gateway-frontend']);
        const build = await this.buildRunner.run(
            buildGatewayReleaseCommands(workspace.root, workspace.needsInstall, this.config)
        );
        if (!build.ok) throw new Error(`Gateway release build failed: ${build.output.slice(-4000)}`);
        const migration = await this.buildRunner.run([buildGatewayMigrationCommand(workspace.root, this.config)]);
        if (!migration.ok) throw new Error(`Gateway migration failed: ${migration.output.slice(-4000)}`);

        const previousDefinitions = state.activeWorkspace
            ? buildGatewayProcessDefinitions(state.activeWorkspace, this.config)
            : [];
        await this.stopManagedProcesses();
        try {
            await this.startDefinitions(buildGatewayProcessDefinitions(workspace.root, this.config));
            await this.waitForReadiness();
        } catch (error) {
            await this.stopManagedProcesses();
            if (previousDefinitions.length) {
                await this.startDefinitions(previousDefinitions);
                await this.waitForReadiness();
            }
            throw error;
        }
        await this.repository.publishRelease(operation.id, this.ownerId, {
            commitSha,
            workspace: workspace.root,
            previousCommitSha: state.activeCommitSha,
            previousWorkspace: state.activeWorkspace,
        });
    }

    private async startDefinitions(definitions: ProcessDefinition[]): Promise<void> {
        const started: string[] = [];
        try {
            for (const definition of definitions) {
                await this.processManager.start(definition);
                started.push(definition.name);
            }
        } catch (error) {
            for (const name of started.reverse()) {
                try {
                    await this.processManager.delete(name);
                } catch {
                    // Preserve the start failure.
                }
            }
            throw error;
        }
    }

    private async stopManagedProcesses(): Promise<void> {
        const existing = new Set((await this.processManager.list()).map((process) => process.name));
        const failures: string[] = [];
        for (const name of [...PROCESS_NAMES].reverse()) {
            if (!existing.has(name)) continue;
            try {
                await this.processManager.stop(name);
            } catch {
                // Delete below is authoritative.
            }
            try {
                await this.processManager.delete(name);
            } catch (error) {
                if (!isMissingProcessError(error)) failures.push(`${name}: ${String(error)}`);
            }
        }
        if (failures.length) throw new Error(`Failed to stop gateway processes: ${failures.join('; ')}`);
    }

    private async waitForReadiness(): Promise<void> {
        const deadline = Date.now() + this.config.readinessTimeoutMs;
        const apiUrl = `http://127.0.0.1:${this.config.gatewayApiPort}/healthz`;
        const frontendUrl = `http://127.0.0.1:${this.config.gatewayFrontendPort}${this.config.gatewayBasePath}/`;
        while (Date.now() < deadline) {
            try {
                const [api, frontend] = await Promise.all([this.fetchImpl(apiUrl), this.fetchImpl(frontendUrl)]);
                const processes = await this.processManager.list();
                const expected = processes.filter((process) => PROCESS_NAMES.includes(process.name as (typeof PROCESS_NAMES)[number]));
                const safe = expected.filter(
                    (process) => process.status.toLowerCase() === 'online' && (process.restartCount ?? 0) === 0
                );
                if (
                    api.ok &&
                    frontend.ok &&
                    expected.length === PROCESS_NAMES.length &&
                    safe.length === PROCESS_NAMES.length &&
                    new Set(safe.map((process) => process.name)).size === PROCESS_NAMES.length
                ) {
                    return;
                }
            } catch {
                // Retry until the bounded deadline.
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 500));
        }
        throw new Error('Gateway release did not become ready before the timeout.');
    }
}
