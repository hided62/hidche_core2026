import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';

import {
    assertReleaseComponents,
    buildTurboReleaseCommand,
    buildTurboReleaseTaskCommand,
    DEFAULT_FRONTEND_ARTIFACT_KEEP_NEWEST,
    DEFAULT_FRONTEND_ARTIFACT_RETENTION_MS,
    DEFAULT_MANAGED_WORKSPACE_KEEP_NEWEST,
    DEFAULT_MANAGED_WORKSPACE_RETENTION_MS,
    type BuildCommand,
    type BuildProgressEvent,
    type BuildRunner,
    type GatewayReleaseOperationRecord,
    type GatewayReleaseRepository,
    type GatewayReleaseStateRecord,
    type FrontendArtifactCleanupResult,
    type GitWorkspaceManager,
    type ProcessDefinition,
    type ProcessManager,
    createReleaseBuildRunner,
    FrontendArtifactManager,
    readReleaseManifest,
    sanitizeManagedProcessEnv,
    sanitizeReleaseBuildEnv,
} from '@sammo-ts/gateway-api';
import { resolvePostgresPoolMax } from '@sammo-ts/infra';

import type { ReleaseControllerConfig } from './config.js';

const LEASE_DURATION_MS = 10 * 60_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const CANCELLATION_POLL_INTERVAL_MS = 500;
const MANAGED_PROCESS_NAMES = ['sammo:gateway-api', 'sammo:gateway-frontend', 'sammo:gateway-orchestrator'] as const;
const SENSITIVE_ENV_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|CLIENT_SECRET|DATABASE_URL|REDIS_URL)/iu;
export const RELEASE_WORKSPACE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export interface ReleaseManagedCleanupResult {
    workspaces: { removed: string[]; skipped: string[] };
    artifacts: FrontendArtifactCleanupResult;
}

const isRuntimeProcessActive = (status: string): boolean =>
    ['online', 'launching', 'stopping'].includes(status.toLowerCase());

const isPathInside = (candidate: string | undefined, root: string): boolean => {
    if (!candidate) return false;
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

const managedPostgresPoolMax = (env: Record<string, string>, roleVariable: string, fallback: number): string =>
    String(resolvePostgresPoolMax(env[roleVariable] ?? env.POSTGRES_POOL_MAX, fallback));

const buildGatewayReleaseCommands = (
    workspaceRoot: string,
    needsInstall: boolean,
    config: ReleaseControllerConfig
): BuildCommand[] => {
    const env = sanitizeReleaseBuildEnv({
        ...config.baseEnv,
        NODE_OPTIONS: config.baseEnv.RELEASE_BUILD_NODE_OPTIONS ?? config.baseEnv.NODE_OPTIONS,
        VITE_APP_BASE_PATH: config.gatewayBasePath,
        VITE_GATEWAY_API_URL: `${config.gatewayBasePath}/api/trpc`,
        VITE_GAME_API_URL_TEMPLATE: '/{profile}/api/trpc',
        VITE_GAME_WEB_URL_TEMPLATE: '/{profile}/',
    });
    return [
        ...(needsInstall ? [{ command: 'pnpm', args: ['install', '--frozen-lockfile'], cwd: workspaceRoot, env }] : []),
        buildTurboReleaseCommand(workspaceRoot, config.workspaceRoot, ['@sammo-ts/gateway-api'], env),
        buildTurboReleaseTaskCommand(
            workspaceRoot,
            config.workspaceRoot,
            'build:release',
            ['@sammo-ts/gateway-frontend'],
            env
        ),
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
    const redisUrl = config.baseEnv.REDIS_URL?.trim();
    if (!redisUrl) {
        throw new Error('REDIS_URL is required to start Gateway processes.');
    }
    const apiCwd = path.join(workspaceRoot, 'app', 'gateway-api');
    const frontendCwd = path.join(workspaceRoot, 'app', 'gateway-frontend');
    const apiScript = path.join(apiCwd, 'dist', 'index.js');
    const frontendScript = path.join(frontendCwd, 'node_modules', 'vite', 'bin', 'vite.js');
    const env = {
        ...sanitizeManagedProcessEnv(config.baseEnv),
        REDIS_URL: redisUrl,
        GATEWAY_API_HOST: '0.0.0.0',
        GATEWAY_API_PORT: String(config.gatewayApiPort),
        GATEWAY_DATABASE_URL: config.gatewayDatabaseUrl,
    };
    const definitions: ProcessDefinition[] = [
        {
            name: 'sammo:gateway-api',
            script: apiScript,
            cwd: apiCwd,
            env: {
                ...env,
                POSTGRES_POOL_MAX: managedPostgresPoolMax(config.baseEnv, 'GATEWAY_API_POSTGRES_POOL_MAX', 4),
                GATEWAY_ROLE: 'api',
            },
        },
        {
            name: 'sammo:gateway-orchestrator',
            script: apiScript,
            cwd: apiCwd,
            env: {
                ...env,
                POSTGRES_POOL_MAX: managedPostgresPoolMax(config.baseEnv, 'GATEWAY_ORCHESTRATOR_POSTGRES_POOL_MAX', 2),
                GATEWAY_ROLE: 'orchestrator',
            },
        },
    ];
    if (config.frontendServeMode !== 'static') {
        definitions.splice(1, 0, {
            name: 'sammo:gateway-frontend',
            script: frontendScript,
            cwd: frontendCwd,
            args: ['preview', '--host', '0.0.0.0', '--port', String(config.gatewayFrontendPort)],
            env,
        });
    }
    return definitions;
};

const isMissingProcessError = (error: unknown): boolean =>
    error instanceof Error && /process or namespace not found/i.test(error.message);

export class GatewayReleaseController {
    private readonly ownerId = randomUUID();
    private readonly releaseBuildRunner: BuildRunner;
    private readonly artifactManager: FrontendArtifactManager;

    constructor(
        private readonly repository: GatewayReleaseRepository,
        private readonly workspaceManager: GitWorkspaceManager,
        private readonly migrationRunner: BuildRunner,
        private readonly processManager: ProcessManager,
        private readonly config: ReleaseControllerConfig,
        private readonly now: () => Date = () => new Date(),
        private readonly fetchImpl: typeof fetch = fetch
    ) {
        this.releaseBuildRunner = createReleaseBuildRunner(config.releaseBuilderUrl, migrationRunner, fetchImpl);
        this.artifactManager = new FrontendArtifactManager(config.frontendArtifactRoot ?? '/srv/frontend-artifacts');
    }

    async cleanupStaleWorkspaces(): Promise<{ removed: string[]; skipped: string[] }> {
        const [state, processes, workspaces] = await Promise.all([
            this.repository.getState(),
            this.processManager.list(),
            this.workspaceManager.listManagedWorkspaces(),
        ]);
        const protectedWorkspaces = new Set<string>();
        if (state.activeWorkspace) protectedWorkspaces.add(path.resolve(state.activeWorkspace));
        if (state.previousWorkspace) protectedWorkspaces.add(path.resolve(state.previousWorkspace));
        const activeProcesses = processes.filter((process) => isRuntimeProcessActive(process.status));
        for (const workspace of workspaces) {
            if (
                activeProcesses.some(
                    (process) =>
                        isPathInside(process.cwd, workspace.root) || isPathInside(process.script, workspace.root)
                )
            ) {
                protectedWorkspaces.add(workspace.root);
            }
        }
        return this.workspaceManager.cleanup({
            protectedPaths: [...protectedWorkspaces],
            retentionMs: DEFAULT_MANAGED_WORKSPACE_RETENTION_MS,
            keepNewest: DEFAULT_MANAGED_WORKSPACE_KEEP_NEWEST,
        });
    }

    async cleanupStaleResources(): Promise<ReleaseManagedCleanupResult> {
        const workspaces = await this.cleanupStaleWorkspaces();
        let artifacts: FrontendArtifactCleanupResult = { removed: [], retained: [], skipped: [] };
        if (this.config.frontendServeMode === 'static') {
            const [state, operations] = await Promise.all([
                this.repository.getState(),
                this.repository.listOperations(100),
            ]);
            artifacts = await this.artifactManager.cleanup({
                frontendKeys: ['gateway'],
                protectedCommitShas: [
                    ...[state.activeCommitSha, state.previousCommitSha].filter((commitSha): commitSha is string =>
                        Boolean(commitSha)
                    ),
                    ...operations
                        .filter(
                            (operation) =>
                                operation.resolvedCommitSha &&
                                (operation.status === 'QUEUED' || operation.status === 'RUNNING')
                        )
                        .map((operation) => operation.resolvedCommitSha as string),
                ],
                retentionMs: DEFAULT_FRONTEND_ARTIFACT_RETENTION_MS,
                keepNewest: DEFAULT_FRONTEND_ARTIFACT_KEEP_NEWEST,
                now: this.now(),
            });
        }
        return { workspaces, artifacts };
    }

    private sanitizeLogMessage(message: string): string {
        let sanitized = stripVTControlCharacters(message);
        const sensitiveValues = new Set([
            this.config.gatewayDatabaseUrl,
            ...Object.entries(this.config.baseEnv)
                .filter(([name]) => SENSITIVE_ENV_NAME.test(name))
                .map(([, value]) => value),
        ]);
        for (const secret of sensitiveValues) {
            if (secret && secret.length >= 4) sanitized = sanitized.replaceAll(secret, '[REDACTED]');
        }
        return sanitized.replace(/(:\/\/[^:\s/@]+:)[^@\s/]+@/gu, '$1[REDACTED]@').slice(0, 4_000);
    }

    private async appendLog(
        operationId: string,
        phase: string,
        message: string,
        level: 'INFO' | 'OUTPUT' | 'ERROR' = 'INFO'
    ): Promise<void> {
        try {
            await this.repository.appendOperationLog(operationId, {
                level,
                phase,
                message: this.sanitizeLogMessage(message),
            });
        } catch {
            // The first deployment that creates the log table must remain deployable.
        }
    }

    private readonly buildProgress = (operationId: string, phase: string) => async (event: BuildProgressEvent) => {
        if (event.type === 'OUTPUT') {
            if (event.message) await this.appendLog(operationId, phase, event.message, 'OUTPUT');
            return;
        }
        const command = [event.command.command, ...event.command.args].join(' ');
        if (event.type === 'COMMAND_START') {
            await this.appendLog(operationId, phase, `$ ${command}`);
            return;
        }
        await this.appendLog(
            operationId,
            phase,
            `${command} 종료 (exit ${event.exitCode ?? 'unknown'})`,
            event.exitCode === 0 ? 'INFO' : 'ERROR'
        );
    };

    async runOnce(): Promise<GatewayReleaseOperationRecord | null> {
        const operation = await this.repository.claimNextOperation(this.now(), {
            ownerId: this.ownerId,
            durationMs: LEASE_DURATION_MS,
        });
        if (!operation) return null;
        await this.appendLog(operation.id, 'claim', `릴리스 작업을 시작합니다. 시도 ${operation.attempts}회차.`);
        const abortController = new AbortController();
        const heartbeat = setInterval(() => {
            void this.repository
                .renewOperationLease(operation.id, this.ownerId, this.now(), LEASE_DURATION_MS)
                .then((renewed) => {
                    if (!renewed) abortController.abort();
                })
                .catch(() => undefined);
        }, HEARTBEAT_INTERVAL_MS);
        const cancellationWatcher = setInterval(() => {
            void this.repository
                .getOperation(operation.id)
                .then((current) => {
                    if (!current || current.status !== 'RUNNING' || current.leaseOwner !== this.ownerId) {
                        abortController.abort();
                    }
                })
                .catch(() => undefined);
        }, CANCELLATION_POLL_INTERVAL_MS);
        let resolvedCommitSha: string | undefined;
        try {
            await this.appendLog(operation.id, 'resolve', '현재 Gateway 릴리스 상태를 확인합니다.');
            const state = await this.repository.getState();
            const deploymentState: GatewayReleaseStateRecord = {
                ...state,
                activeCommitSha: state.activeCommitSha ?? (await this.workspaceManager.resolveCommit('COMMIT', 'HEAD')),
                activeWorkspace: state.activeWorkspace ?? this.config.workspaceRoot,
            };
            const sourceMode = operation.sourceMode ?? 'COMMIT';
            const sourceRef = operation.sourceRef ?? state.previousCommitSha;
            if (!sourceRef) throw new Error('Release source is missing.');
            await this.appendLog(operation.id, 'resolve', `${sourceMode} ${sourceRef} 커밋을 해석합니다.`);
            resolvedCommitSha = await this.workspaceManager.resolveCommit(sourceMode, sourceRef);
            if (!(await this.repository.pinOperationResolvedCommit(operation.id, this.ownerId, resolvedCommitSha))) {
                throw new Error('Gateway release lease was lost while pinning the commit.');
            }
            await this.appendLog(operation.id, 'resolve', `대상 커밋을 ${resolvedCommitSha}로 고정했습니다.`);
            await this.deploy(operation, deploymentState, resolvedCommitSha, abortController.signal);
            await this.appendLog(operation.id, 'complete', 'Gateway 릴리스가 완료되었습니다.');
            return await this.repository.completeOperation(
                operation.id,
                'SUCCEEDED',
                { resolvedCommitSha, error: null },
                this.ownerId
            );
        } catch (error) {
            const current = await this.repository.getOperation(operation.id);
            if (
                !current ||
                current.status !== 'RUNNING' ||
                (abortController.signal.aborted && current.leaseOwner !== this.ownerId)
            ) {
                if (current?.status === 'CANCELLED') {
                    await this.appendLog(operation.id, 'cancel', '실행 중인 Gateway 빌드가 종료되었습니다.');
                }
                return current;
            }
            const detail = error instanceof Error ? error.message : String(error);
            await this.appendLog(operation.id, 'failed', detail, 'ERROR');
            await this.repository.recordStateError(detail);
            return await this.repository.completeOperation(
                operation.id,
                'FAILED',
                { resolvedCommitSha, error: detail },
                this.ownerId
            );
        } finally {
            clearInterval(heartbeat);
            clearInterval(cancellationWatcher);
        }
    }

    private async assertOperationLease(operationId: string): Promise<void> {
        if (!(await this.repository.renewOperationLease(operationId, this.ownerId, this.now(), LEASE_DURATION_MS))) {
            throw new Error(`Gateway release lease lost: ${operationId}`);
        }
    }

    private async deploy(
        operation: GatewayReleaseOperationRecord,
        state: GatewayReleaseStateRecord,
        commitSha: string,
        signal: AbortSignal
    ): Promise<void> {
        await this.appendLog(operation.id, 'workspace', `커밋 ${commitSha}의 worktree를 준비합니다.`);
        const workspace = await this.workspaceManager.prepare(commitSha);
        await this.appendLog(operation.id, 'workspace', `worktree 준비 완료: ${workspace.root}`);
        const manifest = await readReleaseManifest(workspace.root);
        assertReleaseComponents(manifest, ['gateway-api', 'gateway-frontend']);
        await this.appendLog(operation.id, 'build', 'Gateway 구성 요소를 빌드합니다.');
        const build = await this.releaseBuildRunner.run(
            buildGatewayReleaseCommands(workspace.root, workspace.needsInstall, this.config),
            this.buildProgress(operation.id, 'build'),
            { signal }
        );
        if (!build.ok) throw new Error(`Gateway release build failed: ${build.output.slice(-4000)}`);
        const stagedArtifact =
            this.config.frontendServeMode === 'static'
                ? await this.artifactManager.stage({
                      frontendKey: 'gateway',
                      sourceRoot: path.join(workspace.root, 'app', 'gateway-frontend', 'dist'),
                      commitSha,
                  })
                : null;
        await this.appendLog(operation.id, 'migration', 'Gateway database migration을 적용합니다.');
        await this.assertOperationLease(operation.id);
        const migration = await this.migrationRunner.run(
            [buildGatewayMigrationCommand(workspace.root, this.config)],
            this.buildProgress(operation.id, 'migration'),
            { signal }
        );
        if (!migration.ok) throw new Error(`Gateway migration failed: ${migration.output.slice(-4000)}`);
        await this.appendLog(operation.id, 'migration', 'Gateway database migration이 완료되었습니다.');

        const previousDefinitions = state.activeWorkspace
            ? buildGatewayProcessDefinitions(state.activeWorkspace, this.config)
            : [];
        await this.appendLog(operation.id, 'switch', '기존 Gateway process를 정지합니다.');
        await this.assertOperationLease(operation.id);
        await this.stopManagedProcesses(operation.id);
        const previousArtifactReleaseId =
            this.config.frontendServeMode === 'static'
                ? await this.artifactManager.readCurrentReleaseId('gateway')
                : null;
        try {
            await this.startDefinitions(buildGatewayProcessDefinitions(workspace.root, this.config), operation.id);
            if (stagedArtifact) {
                await this.artifactManager.activate('gateway', stagedArtifact.releaseId);
            }
            await this.waitForReadiness(operation.id);
        } catch (error) {
            await this.appendLog(
                operation.id,
                'rollback',
                '새 Gateway 시작에 실패하여 이전 process를 복구합니다.',
                'ERROR'
            );
            await this.stopManagedProcesses(operation.id);
            if (this.config.frontendServeMode === 'static') {
                if (previousArtifactReleaseId) {
                    await this.artifactManager.activate('gateway', previousArtifactReleaseId);
                } else {
                    await this.artifactManager.deactivate('gateway');
                }
            }
            if (previousDefinitions.length) {
                await this.startDefinitions(previousDefinitions, operation.id);
                await this.waitForReadiness(operation.id);
            }
            throw error;
        }
        await this.appendLog(operation.id, 'publish', '검증된 Gateway 릴리스를 active 상태로 게시합니다.');
        const activeReleaseGitRef = this.config.activeReleaseGitRef;
        const previousPersistentCommit = activeReleaseGitRef
            ? await this.workspaceManager.readPersistentReleaseRef(activeReleaseGitRef)
            : null;
        if (activeReleaseGitRef) {
            await this.workspaceManager.compareAndSwapPersistentReleaseRef(
                activeReleaseGitRef,
                previousPersistentCommit,
                commitSha
            );
        }
        try {
            await this.repository.publishRelease(operation.id, this.ownerId, {
                commitSha,
                workspace: workspace.root,
                previousCommitSha: state.activeCommitSha,
                previousWorkspace: state.activeWorkspace,
            });
        } catch (error) {
            if (activeReleaseGitRef) {
                try {
                    await this.workspaceManager.compareAndSwapPersistentReleaseRef(
                        activeReleaseGitRef,
                        commitSha,
                        previousPersistentCommit
                    );
                } catch (rollbackError) {
                    await this.appendLog(
                        operation.id,
                        'rollback',
                        `Gateway bootstrap ref 복구 실패: ${String(rollbackError)}`,
                        'ERROR'
                    );
                }
            }
            throw error;
        }
    }

    private async startDefinitions(definitions: ProcessDefinition[], operationId: string): Promise<void> {
        const started: string[] = [];
        try {
            for (const definition of definitions) {
                await this.appendLog(operationId, 'switch', `${definition.name} process를 시작합니다.`);
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

    private async stopManagedProcesses(operationId: string): Promise<void> {
        const existing = new Set((await this.processManager.list()).map((process) => process.name));
        const failures: string[] = [];
        for (const name of [...MANAGED_PROCESS_NAMES].reverse()) {
            if (!existing.has(name)) continue;
            await this.appendLog(operationId, 'switch', `${name} process를 정리합니다.`);
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

    private async waitForReadiness(operationId: string): Promise<void> {
        await this.appendLog(operationId, 'readiness', 'Gateway API, 정적 frontend와 PM2 process readiness를 확인합니다.');
        const deadline = Date.now() + this.config.readinessTimeoutMs;
        const apiUrl = `http://127.0.0.1:${this.config.gatewayApiPort}/healthz`;
        const frontendUrl =
            this.config.frontendServeMode === 'static'
                ? new URL(
                      `${this.config.gatewayBasePath.replace(/\/$/u, '')}/`,
                      this.config.frontendReadinessOrigin ?? 'http://caddy'
                  ).toString()
                : `http://127.0.0.1:${this.config.gatewayFrontendPort}${this.config.gatewayBasePath}/`;
        const expectedNames = buildGatewayProcessDefinitions(this.config.workspaceRoot, this.config).map(
            (definition) => definition.name
        );
        while (Date.now() < deadline) {
            try {
                const [api, frontend] = await Promise.all([
                    this.fetchImpl(apiUrl),
                    this.fetchImpl(frontendUrl),
                ]);
                const processes = await this.processManager.list();
                const expected = processes.filter((process) => expectedNames.includes(process.name));
                const safe = expected.filter(
                    (process) => process.status.toLowerCase() === 'online' && (process.restartCount ?? 0) === 0
                );
                if (
                    api.ok &&
                    frontend.ok &&
                    expected.length === expectedNames.length &&
                    safe.length === expectedNames.length &&
                    new Set(safe.map((process) => process.name)).size === expectedNames.length
                ) {
                    await this.appendLog(operationId, 'readiness', 'Gateway readiness 확인을 통과했습니다.');
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
