import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';

import {
    assertReleaseComponents,
    buildTurboReleaseCommand,
    buildTurboReleaseTaskCommand,
    type BuildCommand,
    type BuildProgressEvent,
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
import { resolvePostgresPoolMax } from '@sammo-ts/infra';

import type { ReleaseControllerConfig } from './config.js';

const LEASE_DURATION_MS = 10 * 60_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const CANCELLATION_POLL_INTERVAL_MS = 500;
const PROCESS_NAMES = ['sammo:gateway-api', 'sammo:gateway-frontend', 'sammo:gateway-orchestrator'] as const;
const SENSITIVE_ENV_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|CLIENT_SECRET|DATABASE_URL|REDIS_URL)/iu;

const managedPostgresPoolMax = (env: Record<string, string>, roleVariable: string, fallback: number): string =>
    String(resolvePostgresPoolMax(env[roleVariable] ?? env.POSTGRES_POOL_MAX, fallback));

const buildGatewayReleaseCommands = (
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
    return [
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
            env: {
                ...env,
                POSTGRES_POOL_MAX: managedPostgresPoolMax(config.baseEnv, 'GATEWAY_ORCHESTRATOR_POSTGRES_POOL_MAX', 2),
                GATEWAY_ROLE: 'orchestrator',
            },
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
        const build = await this.buildRunner.run(
            buildGatewayReleaseCommands(workspace.root, workspace.needsInstall, this.config),
            this.buildProgress(operation.id, 'build'),
            { signal }
        );
        if (!build.ok) throw new Error(`Gateway release build failed: ${build.output.slice(-4000)}`);
        await this.appendLog(operation.id, 'migration', 'Gateway database migration을 적용합니다.');
        await this.assertOperationLease(operation.id);
        const migration = await this.buildRunner.run(
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
        try {
            await this.startDefinitions(buildGatewayProcessDefinitions(workspace.root, this.config), operation.id);
            await this.waitForReadiness(operation.id);
        } catch (error) {
            await this.appendLog(
                operation.id,
                'rollback',
                '새 Gateway 시작에 실패하여 이전 process를 복구합니다.',
                'ERROR'
            );
            await this.stopManagedProcesses(operation.id);
            if (previousDefinitions.length) {
                await this.startDefinitions(previousDefinitions, operation.id);
                await this.waitForReadiness(operation.id);
            }
            throw error;
        }
        await this.appendLog(operation.id, 'publish', '검증된 Gateway 릴리스를 active 상태로 게시합니다.');
        await this.repository.publishRelease(operation.id, this.ownerId, {
            commitSha,
            workspace: workspace.root,
            previousCommitSha: state.activeCommitSha,
            previousWorkspace: state.activeWorkspace,
        });
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
        for (const name of [...PROCESS_NAMES].reverse()) {
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
        await this.appendLog(operationId, 'readiness', 'Gateway API, frontend와 PM2 process readiness를 확인합니다.');
        const deadline = Date.now() + this.config.readinessTimeoutMs;
        const apiUrl = `http://127.0.0.1:${this.config.gatewayApiPort}/healthz`;
        const frontendUrl = `http://127.0.0.1:${this.config.gatewayFrontendPort}${this.config.gatewayBasePath}/`;
        while (Date.now() < deadline) {
            try {
                const [api, frontend] = await Promise.all([this.fetchImpl(apiUrl), this.fetchImpl(frontendUrl)]);
                const processes = await this.processManager.list();
                const expected = processes.filter((process) =>
                    PROCESS_NAMES.includes(process.name as (typeof PROCESS_NAMES)[number])
                );
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
