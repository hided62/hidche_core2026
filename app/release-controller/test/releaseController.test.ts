import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
    BuildRunner,
    GatewayReleaseOperationRecord,
    GatewayReleaseRepository,
    GatewayReleaseStateRecord,
    GitWorkspaceManager,
    ProcessDefinition,
    ProcessManager,
} from '@sammo-ts/gateway-api';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveReleaseControllerConfig, type ReleaseControllerConfig } from '../src/config.js';
import { buildGatewayProcessDefinitions, GatewayReleaseController } from '../src/releaseController.js';
import { buildReleaseControllerDefinition, upgradeReleaseController } from '../src/selfUpgrade.js';

const SHA = '1111111111111111111111111111111111111111';
const OLD_SHA = '2222222222222222222222222222222222222222';
const temporaryDirectories: string[] = [];

const createReleaseWorkspace = async (): Promise<string> => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-release-controller-'));
    temporaryDirectories.push(workspace);
    const gatewayHead = '20260801000000_gateway';
    const gameHead = '20260801000000_game';
    await fs.mkdir(path.join(workspace, 'packages/infra/prisma/gateway-migrations', gatewayHead), {
        recursive: true,
    });
    await fs.mkdir(path.join(workspace, 'packages/infra/prisma/migrations', gameHead), { recursive: true });
    await fs.writeFile(
        path.join(workspace, 'release-manifest.json'),
        JSON.stringify({
            formatVersion: 1,
            controllerProtocol: 1,
            gatewaySchemaHead: gatewayHead,
            gameSchemaHead: gameHead,
            components: ['gateway-api', 'gateway-frontend', 'release-controller'],
        })
    );
    return workspace;
};

const operation: GatewayReleaseOperationRecord = {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'DEPLOY',
    status: 'RUNNING',
    sourceMode: 'COMMIT',
    sourceRef: SHA,
    payload: {},
    requestedBy: 'admin',
    attempts: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
};

const state: GatewayReleaseStateRecord = {
    id: 'gateway',
    activeCommitSha: OLD_SHA,
    activeWorkspace: '/srv/sammo/old',
    updatedAt: '2026-08-01T00:00:00.000Z',
};

const config: ReleaseControllerConfig = {
    workspaceRoot: '/srv/sammo/controller',
    worktreeRoot: '/srv/sammo/releases',
    gatewayDatabaseUrl: 'postgresql://integration.invalid/sammo?schema=gateway',
    gatewayDbSchema: 'gateway',
    gatewayApiPort: 15001,
    gatewayFrontendPort: 15000,
    gatewayBasePath: '/gateway',
    pollIntervalMs: 5,
    readinessTimeoutMs: 10,
    postgresPoolMax: 2,
    baseEnv: {
        REDIS_URL: 'redis://integration.invalid:6379/0',
        GATEWAY_BOOTSTRAP_TOKEN: 'bootstrap-secret-value',
    },
};

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

const createRepository = () => {
    let next: GatewayReleaseOperationRecord | null = operation;
    const completions: string[] = [];
    const published: Array<{ commitSha: string; workspace: string; previousCommitSha?: string }> = [];
    const errors: string[] = [];
    const logs: Array<{ level: string; phase: string; message: string }> = [];
    const repository: GatewayReleaseRepository = {
        getState: async () => state,
        listOperations: async () => [],
        getOperation: async () => operation,
        listOperationLogs: async () => [],
        appendOperationLog: async (id, input) => {
            logs.push(input);
            return {
                cursor: String(logs.length),
                operationId: id,
                createdAt: '2026-08-01T00:00:00.000Z',
                ...input,
            };
        },
        createOperation: async () => operation,
        claimNextOperation: async () => {
            const claimed = next;
            next = null;
            return claimed;
        },
        renewOperationLease: async () => true,
        pinOperationResolvedCommit: async () => true,
        completeOperation: async (_id, statusValue) => {
            completions.push(statusValue);
            return { ...operation, status: statusValue };
        },
        publishRelease: async (_id, _owner, release) => {
            published.push(release);
            return { ...state, activeCommitSha: release.commitSha, activeWorkspace: release.workspace };
        },
        recordStateError: async (detail) => {
            errors.push(detail);
        },
        cancelOperation: async () => false,
        retryOperation: async () => null,
    };
    return { repository, completions, published, errors, logs };
};

const gatewayNames = ['sammo:gateway-api', 'sammo:gateway-frontend', 'sammo:gateway-orchestrator'];

it('runs Gateway preview from the frontend workspace dependency', () => {
    const definitions = buildGatewayProcessDefinitions('/srv/sammo/release', config);
    const frontend = definitions.find((definition) => definition.name === 'sammo:gateway-frontend');
    expect(frontend?.script).toBe('/srv/sammo/release/app/gateway-frontend/node_modules/vite/bin/vite.js');
    expect(definitions.find((definition) => definition.name === 'sammo:gateway-api')?.env).toHaveProperty(
        'POSTGRES_POOL_MAX',
        '4'
    );
    expect(definitions.find((definition) => definition.name === 'sammo:gateway-orchestrator')?.env).toHaveProperty(
        'POSTGRES_POOL_MAX',
        '2'
    );
});

it('does not forward release-controller PM2 identity to Gateway processes', () => {
    const definitions = buildGatewayProcessDefinitions('/srv/sammo/release', {
        ...config,
        baseEnv: {
            DATABASE_URL: 'postgresql://integration.invalid/sammo',
            REDIS_URL: 'redis://integration.invalid:6379/0',
            GATEWAY_ROLE: 'orchestrator',
            args: 'daemon',
            name: 'sammo:release-controller',
            pm_id: '3',
            pm_exec_path: '/srv/release-controller.js',
        },
    });

    for (const definition of definitions) {
        expect(definition.env).toMatchObject({ DATABASE_URL: 'postgresql://integration.invalid/sammo' });
        expect(definition.env).not.toHaveProperty('pm_id');
        expect(definition.env).not.toHaveProperty('args');
        expect(definition.env).not.toHaveProperty('pm_exec_path');
        expect(definition.env).not.toHaveProperty('name');
    }
});

it('rejects Gateway definitions before switching processes when Redis connection context is missing', () => {
    expect(() =>
        buildGatewayProcessDefinitions('/srv/sammo/release', {
            ...config,
            baseEnv: {},
        })
    ).toThrow('REDIS_URL is required to start Gateway processes.');
});

describe('GatewayReleaseController', () => {
    it('builds, migrates, switches all gateway roles, verifies readiness, and publishes atomically', async () => {
        const workspace = await createReleaseWorkspace();
        const harness = createRepository();
        const commandGroups: string[][] = [];
        const running = new Map(gatewayNames.map((name) => [name, '/srv/sammo/old']));
        const processManager: ProcessManager = {
            list: async () =>
                [...running].map(([name, cwd]) => ({ name, cwd, status: 'online', script: path.join(cwd, 'dist.js') })),
            start: async (definition) => {
                running.set(definition.name, definition.cwd);
            },
            stop: async () => {},
            delete: async (name) => {
                running.delete(name);
            },
        };
        const buildRunner: BuildRunner = {
            run: async (commands) => {
                commandGroups.push(commands.map((command) => command.args.join(' ')));
                return { ok: true, exitCode: 0, output: '' };
            },
        };
        const workspaceManager = {
            resolveCommit: async () => SHA,
            prepare: async () => ({ root: workspace, created: true, needsInstall: true }),
        } as unknown as GitWorkspaceManager;
        const controller = new GatewayReleaseController(
            harness.repository,
            workspaceManager,
            buildRunner,
            processManager,
            config,
            () => new Date('2026-08-01T00:00:00.000Z'),
            async () => new Response('', { status: 200 })
        );

        await controller.runOnce();

        expect(commandGroups).toHaveLength(2);
        expect(commandGroups[0]?.[0]).toBe('install --frozen-lockfile');
        expect(commandGroups[0]?.[1]).toContain('turbo run build');
        expect(commandGroups[0]?.[1]).toContain('--cache-dir=/srv/sammo/controller/.turbo/release-cache');
        expect(commandGroups[0]?.[1]).toContain('--filter=@sammo-ts/gateway-api');
        expect(commandGroups[0]?.[1]).not.toContain('--filter=@sammo-ts/gateway-frontend');
        expect(commandGroups[0]?.[2]).toContain('turbo run build:release');
        expect(commandGroups[0]?.[2]).toContain('--filter=@sammo-ts/gateway-frontend');
        expect(commandGroups[0]?.[2]).toContain('--concurrency=1');
        expect(commandGroups[1]).toEqual(['--filter @sammo-ts/infra prisma:migrate:deploy:gateway']);
        expect([...running.keys()].sort()).toEqual([...gatewayNames].sort());
        expect(harness.published).toEqual([
            { commitSha: SHA, workspace, previousCommitSha: OLD_SHA, previousWorkspace: '/srv/sammo/old' },
        ]);
        expect(harness.completions).toEqual(['SUCCEEDED']);
        expect(harness.logs.map((entry) => entry.phase)).toEqual(
            expect.arrayContaining([
                'claim',
                'resolve',
                'workspace',
                'build',
                'migration',
                'switch',
                'readiness',
                'publish',
            ])
        );
    });

    it('restores the previous gateway processes when the new process set cannot start', async () => {
        const workspace = await createReleaseWorkspace();
        const harness = createRepository();
        const started: ProcessDefinition[] = [];
        const running = new Map(gatewayNames.map((name) => [name, '/srv/sammo/old']));
        const processManager: ProcessManager = {
            list: async () => [...running].map(([name, cwd]) => ({ name, cwd, status: 'online' })),
            start: async (definition) => {
                if (definition.cwd.startsWith(workspace) && definition.name === 'sammo:gateway-api') {
                    throw new Error('new gateway failed');
                }
                started.push(definition);
                running.set(definition.name, definition.cwd);
            },
            stop: async () => {},
            delete: async (name) => {
                running.delete(name);
            },
        };
        const workspaceManager = {
            resolveCommit: async () => SHA,
            prepare: async () => ({ root: workspace, created: true, needsInstall: false }),
        } as unknown as GitWorkspaceManager;
        const controller = new GatewayReleaseController(
            harness.repository,
            workspaceManager,
            { run: async () => ({ ok: true, exitCode: 0, output: '' }) },
            processManager,
            config,
            () => new Date('2026-08-01T00:00:00.000Z'),
            async () => new Response('', { status: 200 })
        );

        await controller.runOnce();

        expect(started.filter((definition) => definition.cwd.startsWith('/srv/sammo/old'))).toHaveLength(3);
        expect(harness.published).toEqual([]);
        expect(harness.completions).toEqual(['FAILED']);
        expect(harness.errors.at(-1)).toContain('new gateway failed');
    });

    it('redacts configured credentials and URI passwords from persisted build output', async () => {
        const workspace = await createReleaseWorkspace();
        const harness = createRepository();
        const processManager: ProcessManager = {
            list: async () => gatewayNames.map((name) => ({ name, status: 'online', restartCount: 0 })),
            start: async () => {},
            stop: async () => {},
            delete: async () => {},
        };
        const buildRunner: BuildRunner = {
            run: async (_commands, onProgress) => {
                await onProgress?.({
                    type: 'OUTPUT',
                    stream: 'stdout',
                    message: 'bootstrap-secret-value postgresql://operator:visible-password@db.invalid/sammo',
                });
                return { ok: true, exitCode: 0, output: '' };
            },
        };
        const controller = new GatewayReleaseController(
            harness.repository,
            {
                resolveCommit: async () => SHA,
                prepare: async () => ({ root: workspace, created: true, needsInstall: false }),
            } as unknown as GitWorkspaceManager,
            buildRunner,
            processManager,
            config,
            () => new Date('2026-08-01T00:00:00.000Z'),
            async () => new Response('', { status: 200 })
        );

        await controller.runOnce();

        const persisted = harness.logs.map((entry) => entry.message).join('\n');
        expect(persisted).not.toContain('bootstrap-secret-value');
        expect(persisted).not.toContain('visible-password');
        expect(persisted).toContain('[REDACTED]');
    });
});

describe('resolveReleaseControllerConfig', () => {
    it('applies the configured gateway schema to the controller database URL', () => {
        const resolved = resolveReleaseControllerConfig({
            GATEWAY_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/sammo?schema=wrong',
            REDIS_URL: 'redis://127.0.0.1:6379/0',
            GATEWAY_DB_SCHEMA: 'gateway_release',
            RELEASE_CONTROLLER_WORKSPACE_ROOT: '/srv/sammo/controller',
        });

        expect(new URL(resolved.gatewayDatabaseUrl).searchParams.get('schema')).toBe('gateway_release');
        expect(resolved.postgresPoolMax).toBe(2);
    });

    it('applies a dedicated release-controller pool budget', () => {
        const resolved = resolveReleaseControllerConfig({
            GATEWAY_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/sammo',
            REDIS_URL: 'redis://127.0.0.1:6379/0',
            RELEASE_CONTROLLER_POSTGRES_POOL_MAX: '3',
        });

        expect(resolved.postgresPoolMax).toBe(3);
    });

    it('removes PM2 metadata from the inherited controller environment', () => {
        const resolved = resolveReleaseControllerConfig({
            GATEWAY_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/sammo',
            REDIS_URL: 'redis://127.0.0.1:6379/0',
            RELEASE_CONTROLLER_WORKSPACE_ROOT: '/srv/sammo/controller',
            args: 'daemon',
            pm_id: '3',
            name: 'sammo:release-controller',
            axm_monitor: '{}',
        });

        expect(resolved.baseEnv).toMatchObject({
            GATEWAY_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/sammo',
            REDIS_URL: 'redis://127.0.0.1:6379/0',
            RELEASE_CONTROLLER_WORKSPACE_ROOT: '/srv/sammo/controller',
        });
        expect(resolved.baseEnv).not.toHaveProperty('pm_id');
        expect(resolved.baseEnv).not.toHaveProperty('args');
        expect(resolved.baseEnv).not.toHaveProperty('name');
        expect(resolved.baseEnv).not.toHaveProperty('axm_monitor');
    });

    it('rejects a controller environment that cannot start Redis-backed Gateway processes', () => {
        expect(() =>
            resolveReleaseControllerConfig({
                GATEWAY_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/sammo',
                RELEASE_CONTROLLER_WORKSPACE_ROOT: '/srv/sammo/controller',
            })
        ).toThrow('REDIS_URL is required.');
    });
});

describe('upgradeReleaseController', () => {
    it('does not forward the old controller PM2 identity to its replacement', () => {
        const definition = buildReleaseControllerDefinition('/srv/sammo/release', {
            ...config,
            baseEnv: {
                DATABASE_URL: 'postgresql://integration.invalid/sammo',
                name: 'sammo:release-controller',
                pm_id: '3',
                pm_exec_path: '/srv/old-controller.js',
            },
        });

        expect(definition.env).toMatchObject({ DATABASE_URL: 'postgresql://integration.invalid/sammo' });
        expect(definition.env).toHaveProperty('RELEASE_CONTROLLER_WORKSPACE_ROOT', config.workspaceRoot);
        expect(definition.env).toHaveProperty('POSTGRES_POOL_MAX', '2');
        expect(definition.env).not.toHaveProperty('pm_id');
        expect(definition.env).not.toHaveProperty('pm_exec_path');
        expect(definition.env).not.toHaveProperty('name');
    });

    it('switches the controller daemon from a separately invoked CLI process', async () => {
        const workspace = await createReleaseWorkspace();
        const running = new Map([['sammo:release-controller', '/srv/sammo/old/app/release-controller']]);
        const starts: ProcessDefinition[] = [];
        const processManager: ProcessManager = {
            list: async () => [...running].map(([name, cwd]) => ({ name, cwd, status: 'online' })),
            start: async (definition) => {
                starts.push(definition);
                running.set(definition.name, definition.cwd);
            },
            stop: async () => {},
            delete: async (name) => {
                running.delete(name);
            },
        };
        const workspaceManager = {
            resolveCommit: async () => SHA,
            prepare: async () => ({ root: workspace, created: true, needsInstall: true }),
        } as unknown as GitWorkspaceManager;
        const commandGroups: string[][] = [];

        await expect(
            upgradeReleaseController({
                sourceMode: 'COMMIT',
                sourceRef: SHA,
                workspaceManager,
                buildRunner: {
                    run: async (commands) => {
                        commandGroups.push(commands.map((command) => command.args.join(' ')));
                        return { ok: true, exitCode: 0, output: '' };
                    },
                },
                processManager,
                config,
                readinessTimeoutMs: 10,
            })
        ).resolves.toEqual({ commitSha: SHA, workspace });

        expect(commandGroups).toHaveLength(2);
        expect(commandGroups[0]?.at(-1)).toContain('turbo run build --filter=@sammo-ts/release-controller');
        expect(starts.at(-1)).toMatchObject({
            name: 'sammo:release-controller',
            cwd: path.join(workspace, 'app', 'release-controller'),
            args: ['daemon'],
        });
    });

    it('restores the old controller definition when the new daemon cannot start', async () => {
        const workspace = await createReleaseWorkspace();
        const starts: ProcessDefinition[] = [];
        const running = new Map([['sammo:release-controller', '/srv/sammo/old/app/release-controller']]);
        const processManager: ProcessManager = {
            list: async () => [...running].map(([name, cwd]) => ({ name, cwd, status: 'online' })),
            start: async (definition) => {
                if (definition.cwd.startsWith(workspace)) throw new Error('new controller failed');
                starts.push(definition);
                running.set(definition.name, definition.cwd);
            },
            stop: async () => {},
            delete: async (name) => {
                running.delete(name);
            },
        };
        const workspaceManager = {
            resolveCommit: async () => SHA,
            prepare: async () => ({ root: workspace, created: true, needsInstall: false }),
        } as unknown as GitWorkspaceManager;

        await expect(
            upgradeReleaseController({
                sourceMode: 'COMMIT',
                sourceRef: SHA,
                workspaceManager,
                buildRunner: { run: async () => ({ ok: true, exitCode: 0, output: '' }) },
                processManager,
                config,
                readinessTimeoutMs: 10,
            })
        ).rejects.toThrow('new controller failed');
        expect(starts.at(-1)?.cwd).toBe('/srv/sammo/old/app/release-controller');
    });
});
