import { describe, expect, it } from 'vitest';

import path from 'node:path';

import {
    buildProfileFrontendCommands,
    buildProfileMigrationCommand,
    buildProcessDefinitions,
    buildSharedProfileFrontendCommands,
    buildWorkspaceCommands,
    planProfileReconcile,
    resolveProfileArchiveServerName,
    resolveResetLifecycleStatus,
} from '../src/orchestrator/gatewayOrchestrator.js';
import { GATEWAY_PROFILE_ORDER } from '../src/profileOrder.js';
import { sanitizeManagedProcessEnv } from '../src/orchestrator/processManager.js';
import type { GatewayProfileRecord } from '../src/orchestrator/profileRepository.js';

const buildProfile = (buildWorkspace?: string): GatewayProfileRecord => ({
    profileName: 'che:2',
    profile: 'che',
    instanceKey: '2',
    currentScenario: '2',
    scenario: '2',
    apiPort: 15003,
    status: 'RUNNING',
    buildStatus: 'SUCCEEDED',
    buildCommitSha: '0123456789abcdef0123456789abcdef01234567',
    buildWorkspace,
    meta: {},
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
});

describe('planProfileReconcile', () => {
    it('starts missing processes for running profiles', () => {
        expect(
            planProfileReconcile('RUNNING', {
                frontendRunning: true,
                apiRunning: true,
                daemonRunning: false,
                auctionRunning: true,
                battleSimRunning: true,
                tournamentRunning: true,
            })
        ).toEqual({ shouldStart: true, shouldStop: false });
    });

    it('starts processes for preopen profiles', () => {
        expect(
            planProfileReconcile('PREOPEN', {
                frontendRunning: false,
                apiRunning: false,
                daemonRunning: false,
                auctionRunning: false,
                battleSimRunning: false,
                tournamentRunning: false,
            })
        ).toEqual({ shouldStart: true, shouldStop: false });
    });

    it('does nothing when running profile is healthy', () => {
        expect(
            planProfileReconcile('RUNNING', {
                frontendRunning: true,
                apiRunning: true,
                daemonRunning: true,
                auctionRunning: true,
                battleSimRunning: true,
                tournamentRunning: true,
            })
        ).toEqual({ shouldStart: false, shouldStop: false });
    });

    it('restarts a running profile when only the auction worker is missing', () => {
        expect(
            planProfileReconcile('RUNNING', {
                frontendRunning: true,
                apiRunning: true,
                daemonRunning: true,
                auctionRunning: false,
                battleSimRunning: true,
                tournamentRunning: true,
            })
        ).toEqual({ shouldStart: true, shouldStop: false });
    });

    it('stops processes for non-running profiles', () => {
        expect(
            planProfileReconcile('STOPPED', {
                frontendRunning: false,
                apiRunning: false,
                daemonRunning: true,
                auctionRunning: false,
                battleSimRunning: false,
                tournamentRunning: false,
            })
        ).toEqual({ shouldStart: false, shouldStop: true });
    });

    it('keeps reserved profiles off', () => {
        expect(
            planProfileReconcile('RESERVED', {
                frontendRunning: false,
                apiRunning: false,
                daemonRunning: false,
                auctionRunning: false,
                battleSimRunning: false,
                tournamentRunning: false,
            })
        ).toEqual({ shouldStart: false, shouldStop: false });
    });
});

describe('resolveResetLifecycleStatus', () => {
    const now = new Date('2030-01-01T00:00:00.000Z');

    it('keeps an initialized profile reserved until the configured preopen time', () => {
        expect(
            resolveResetLifecycleStatus(now, new Date('2030-01-01T01:00:00.000Z'), new Date('2030-01-01T02:00:00.000Z'))
        ).toBe('RESERVED');
    });

    it('moves through preopen before the formal open time', () => {
        expect(
            resolveResetLifecycleStatus(now, new Date('2029-12-31T23:00:00.000Z'), new Date('2030-01-01T02:00:00.000Z'))
        ).toBe('PREOPEN');
    });

    it('runs immediately when no future lifecycle boundary remains', () => {
        expect(resolveResetLifecycleStatus(now, null, null)).toBe('RUNNING');
        expect(
            resolveResetLifecycleStatus(now, new Date('2029-12-31T22:00:00.000Z'), new Date('2029-12-31T23:00:00.000Z'))
        ).toBe('RUNNING');
    });
});

describe('resolveProfileArchiveServerName', () => {
    it('uses the configured Gateway name and never the runtime instance key', () => {
        expect(
            resolveProfileArchiveServerName({
                ...buildProfile(),
                profile: 'hwe',
                profileName: 'hwe:default',
                meta: { korName: ' 훼 ' },
            })
        ).toBe('훼');
    });

    it('uses the canonical profile label when Gateway has no override', () => {
        expect(
            resolveProfileArchiveServerName({
                ...buildProfile(),
                profile: 'hwe',
                profileName: 'hwe:default',
                meta: {},
            })
        ).toBe('훼');
    });
});

describe('buildProcessDefinitions', () => {
    const processConfig = {
        workspaceRoot: '/srv/sammo/main',
        redisKeyPrefix: 'sammo:gateway',
        gameTokenSecret: 'test-secret',
        gatewayInternalApiUrl: 'http://127.0.0.1:13000',
    };

    it('runs a built profile from its commit worktree', () => {
        const buildWorkspace = '/srv/sammo/worktrees/0123456789abcdef';
        const definitions = buildProcessDefinitions(buildProfile(buildWorkspace), processConfig);

        expect(Object.values(definitions)).toHaveLength(6);
        expect(new Set(Object.values(definitions).map((definition) => definition.name)).size).toBe(6);

        expect(definitions.frontend).toMatchObject({
            cwd: path.join(buildWorkspace, 'app', 'game-frontend'),
            script: path.join(buildWorkspace, 'app', 'game-frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
            args: [
                'preview',
                '--host',
                '0.0.0.0',
                '--port',
                '15002',
                '--outDir',
                path.join(buildWorkspace, '.release-dist', 'che_2', 'game-frontend'),
            ],
        });
        expect(definitions.api.cwd).toBe(path.join(buildWorkspace, 'app', 'game-api'));
        expect(definitions.api.script).toBe(path.join(buildWorkspace, 'app', 'game-api', 'dist', 'index.js'));
        expect(definitions.api.env).toMatchObject({
            GAME_PROFILE_NAME: 'che:2',
            POSTGRES_POOL_MAX: '4',
            GAME_TRPC_PATH: '/che/api/trpc',
            GAME_API_EVENTS_PATH: '/che/api/events',
            GATEWAY_INTERNAL_API_URL: 'http://127.0.0.1:13000',
            GAME_UPLOAD_PATH: '/che/api/uploads',
        });
        expect(definitions.daemon.cwd).toBe(path.join(buildWorkspace, 'app', 'game-engine'));
        expect(definitions.daemon.script).toBe(path.join(buildWorkspace, 'app', 'game-engine', 'dist', 'index.js'));
        expect(definitions.daemon.env.POSTGRES_POOL_MAX).toBe('2');
        expect(definitions.auction).toMatchObject({
            cwd: path.join(buildWorkspace, 'app', 'game-api'),
            script: path.join(buildWorkspace, 'app', 'game-api', 'dist', 'index.js'),
            env: { GAME_API_ROLE: 'auction-worker', POSTGRES_POOL_MAX: '1' },
        });
        expect(definitions.battleSim).toMatchObject({
            cwd: path.join(buildWorkspace, 'app', 'game-api'),
            script: path.join(buildWorkspace, 'app', 'game-api', 'dist', 'index.js'),
            env: { GAME_API_ROLE: 'battle-sim-worker', POSTGRES_POOL_MAX: '1' },
        });
        expect(definitions.tournament).toMatchObject({
            cwd: path.join(buildWorkspace, 'app', 'game-api'),
            script: path.join(buildWorkspace, 'app', 'game-api', 'dist', 'index.js'),
            env: { GAME_API_ROLE: 'tournament-worker', POSTGRES_POOL_MAX: '1' },
        });
    });

    it('keeps main as the runtime for profiles without a commit worktree', () => {
        const definitions = buildProcessDefinitions(buildProfile(), processConfig);

        expect(definitions.frontend.cwd).toBe(path.join(processConfig.workspaceRoot, 'app', 'game-frontend'));
        expect(definitions.api.cwd).toBe(path.join(processConfig.workspaceRoot, 'app', 'game-api'));
        expect(definitions.daemon.cwd).toBe(path.join(processConfig.workspaceRoot, 'app', 'game-engine'));
        expect(definitions.auction.cwd).toBe(path.join(processConfig.workspaceRoot, 'app', 'game-api'));
        expect(definitions.battleSim.cwd).toBe(path.join(processConfig.workspaceRoot, 'app', 'game-api'));
        expect(definitions.tournament.cwd).toBe(path.join(processConfig.workspaceRoot, 'app', 'game-api'));
    });

    it('keeps the instance identity stable while passing the mutable current scenario', () => {
        const definitions = buildProcessDefinitions(
            {
                ...buildProfile(),
                profileName: 'che:default',
                instanceKey: 'default',
                currentScenario: '1010',
                scenario: '1010',
            },
            processConfig
        );

        expect(definitions.api.name).toBe('sammo:che:default:game-api');
        expect(definitions.api.env).toMatchObject({
            GAME_PROFILE_NAME: 'che:default',
            SCENARIO: '1010',
        });
        expect(definitions.daemon.env).toMatchObject({
            TURN_PROFILE_NAME: 'che:default',
            SCENARIO: '1010',
        });
    });

    it('uses the legacy default scenario marker only for an uninitialized instance runtime', () => {
        const definitions = buildProcessDefinitions(
            { ...buildProfile(), currentScenario: null, scenario: 'default' },
            processConfig
        );

        expect(definitions.api.env.SCENARIO).toBe('default');
        expect(definitions.daemon.env.SCENARIO).toBe('default');
    });

    it('does not forward PM2 identity or parent runtime roles to profile processes', () => {
        const definitions = buildProcessDefinitions(buildProfile(), {
            ...processConfig,
            baseEnv: {
                DATABASE_URL: 'postgresql://integration.invalid/sammo',
                VITE_APP_BASE_PATH: '/gateway',
                GATEWAY_ROLE: 'orchestrator',
                args: 'daemon',
                NODE_APP_INSTANCE: '2',
                name: 'sammo:gateway-orchestrator',
                pm_id: '2',
                pm_exec_path: '/srv/controller.js',
            },
        });

        for (const definition of Object.values(definitions)) {
            expect(definition.env).not.toHaveProperty('pm_id');
            expect(definition.env).not.toHaveProperty('args');
            expect(definition.env).not.toHaveProperty('pm_exec_path');
            expect(definition.env).not.toHaveProperty('name');
            expect(definition.env).not.toHaveProperty('NODE_APP_INSTANCE');
            expect(definition.env).not.toHaveProperty('GATEWAY_ROLE');
        }
        expect(definitions.frontend.env.DATABASE_URL).toBe('postgresql://integration.invalid/sammo');
        for (const definition of [
            definitions.api,
            definitions.daemon,
            definitions.auction,
            definitions.battleSim,
            definitions.tournament,
        ]) {
            expect(definition.env.DATABASE_URL).toBe('postgresql://integration.invalid/sammo?schema=che');
        }
        expect(definitions.frontend.env.VITE_APP_BASE_PATH).toBe('/che');
    });

    it.each(GATEWAY_PROFILE_ORDER)(
        'passes the encoded %s profile database URL to every backend process',
        (profileName) => {
            const definitions = buildProcessDefinitions(
                {
                    ...buildProfile(),
                    profileName: `${profileName}:default`,
                    profile: profileName,
                    instanceKey: 'default',
                },
                {
                    ...processConfig,
                    baseEnv: {
                        GATEWAY_DATABASE_URL: 'postgresql://sammo:encoded%23password@postgres:5432/sammo?schema=public',
                        POSTGRES_USER: 'sammo',
                        POSTGRES_PASSWORD: 'raw#password',
                        POSTGRES_HOST: 'postgres',
                        POSTGRES_PORT: '5432',
                        POSTGRES_DB: 'sammo',
                    },
                }
            );
            const expectedUrl = `postgresql://sammo:encoded%23password@postgres:5432/sammo?schema=${profileName}`;

            for (const definition of [
                definitions.api,
                definitions.daemon,
                definitions.auction,
                definitions.battleSim,
                definitions.tournament,
            ]) {
                expect(definition.env.DATABASE_URL).toBe(expectedUrl);
            }
            expect(definitions.frontend.env).not.toHaveProperty('DATABASE_URL');
        }
    );

    it('applies a dedicated Node heap option only to the turn daemon', () => {
        const definitions = buildProcessDefinitions(buildProfile(), {
            ...processConfig,
            baseEnv: {
                NODE_OPTIONS: '--max-old-space-size=1536',
                TURN_DAEMON_NODE_OPTIONS: '--max-old-space-size=3072',
            },
        });

        expect(definitions.daemon.env.NODE_OPTIONS).toBe('--max-old-space-size=3072');
        expect(definitions.frontend.env.NODE_OPTIONS).toBe('--max-old-space-size=1536');
        expect(definitions.api.env.NODE_OPTIONS).toBe('--max-old-space-size=1536');
        expect(definitions.auction.env.NODE_OPTIONS).toBe('--max-old-space-size=1536');
        expect(definitions.battleSim.env.NODE_OPTIONS).toBe('--max-old-space-size=1536');
        expect(definitions.tournament.env.NODE_OPTIONS).toBe('--max-old-space-size=1536');
    });

    it('accepts role-specific pool budget overrides without changing sibling roles', () => {
        const definitions = buildProcessDefinitions(buildProfile(), {
            ...processConfig,
            baseEnv: {
                GAME_API_POSTGRES_POOL_MAX: '6',
                AUCTION_WORKER_POSTGRES_POOL_MAX: '2',
            },
        });

        expect(definitions.api.env.POSTGRES_POOL_MAX).toBe('6');
        expect(definitions.daemon.env.POSTGRES_POOL_MAX).toBe('2');
        expect(definitions.auction.env.POSTGRES_POOL_MAX).toBe('2');
        expect(definitions.tournament.env.POSTGRES_POOL_MAX).toBe('1');
    });
});

describe('sanitizeManagedProcessEnv', () => {
    it('keeps application configuration while removing PM2 metadata and role selectors', () => {
        expect(
            sanitizeManagedProcessEnv({
                DATABASE_URL: 'postgresql://integration.invalid/sammo',
                PATH: '/usr/local/bin:/usr/bin',
                GATEWAY_ROLE: 'orchestrator',
                GAME_API_ROLE: 'server',
                args: 'daemon',
                NODE_APP_INSTANCE: '2',
                name: 'sammo:gateway-orchestrator',
                pm_id: '2',
                pm_cwd: '/srv/controller',
                axm_monitor: '{}',
            })
        ).toEqual({
            DATABASE_URL: 'postgresql://integration.invalid/sammo',
            PATH: '/usr/local/bin:/usr/bin',
        });
    });
});

describe('buildWorkspaceCommands', () => {
    it('installs and builds runtime dependencies before the profile processes', () => {
        const workspaceRoot = '/srv/sammo/worktrees/0123456789abcdef';
        const commands = buildWorkspaceCommands(workspaceRoot, true, undefined, '/srv/sammo/controller');

        expect(commands.map(({ args }) => args)).toEqual([
            ['install', '--frozen-lockfile'],
            [
                'exec',
                'turbo',
                'run',
                'build',
                '--filter=@sammo-ts/game-api',
                '--filter=@sammo-ts/gateway-api',
                '--cache-dir=/srv/sammo/controller/.turbo/release-cache',
                '--concurrency=1',
                '--ui=stream',
                '--output-logs=new-only',
            ],
        ]);
        expect(commands.every(({ cwd }) => cwd === workspaceRoot)).toBe(true);
    });

    it('can limit a DB-preserving deploy to the game runtime server target', () => {
        const commands = buildWorkspaceCommands(
            '/srv/sammo/worktrees/0123456789abcdef',
            false,
            undefined,
            '/srv/sammo/controller',
            ['@sammo-ts/game-api']
        );

        expect(commands[0]?.args).toContain('--filter=@sammo-ts/game-api');
        expect(commands[0]?.args).not.toContain('--filter=@sammo-ts/gateway-api');
        expect(commands[0]?.args).toContain('--concurrency=1');
    });

    it('deploys the game schema migration after building the selected workspace', () => {
        const workspaceRoot = '/srv/sammo/worktrees/0123456789abcdef';
        const databaseUrl = 'postgresql://integration.invalid/sammo?schema=che';
        const command = buildProfileMigrationCommand(workspaceRoot, databaseUrl, { NODE_ENV: 'production' });

        expect(command).toEqual({
            command: 'pnpm',
            args: ['--filter', '@sammo-ts/infra', 'prisma:migrate:deploy:game'],
            cwd: workspaceRoot,
            env: {
                NODE_ENV: 'production',
                DATABASE_URL: databaseUrl,
            },
        });
    });
});

describe('buildProfileFrontendCommands', () => {
    const buildCommitSha = '0123456789abcdef0123456789abcdef01234567';

    it('uses a profile frontend build-only Node heap without changing the shared runtime heap', () => {
        const workspaceRoot = '/srv/sammo/worktrees/0123456789abcdef';
        const commands = buildProfileFrontendCommands(workspaceRoot, buildProfile(), buildCommitSha, {
            NODE_OPTIONS: '--max-old-space-size=1536',
            PROFILE_FRONTEND_BUILD_NODE_OPTIONS: '--max-old-space-size=2048',
        });

        expect(commands).toHaveLength(2);
        expect(commands.every((command) => command.env?.NODE_OPTIONS === '--max-old-space-size=2048')).toBe(true);
        expect(
            commands.every(
                (command) => command.env?.PROFILE_FRONTEND_BUILD_NODE_OPTIONS === '--max-old-space-size=2048'
            )
        ).toBe(true);
        expect(commands.every((command) => command.env?.VITE_BUILD_COMMIT_SHA === buildCommitSha)).toBe(true);
        expect(commands[0]?.args).toEqual([
            'exec',
            'turbo',
            'run',
            'build:release',
            '--filter=@sammo-ts/game-frontend',
            '--cache-dir=/srv/sammo/worktrees/0123456789abcdef/.turbo/release-cache',
            '--concurrency=1',
            '--ui=stream',
            '--output-logs=new-only',
        ]);
        expect(commands[1]?.args).toEqual(['tools/build-scripts/materialize-profile-frontend.mjs', 'che:2']);
    });

    it('keeps the shared Node heap when no frontend build override is configured', () => {
        const workspaceRoot = '/srv/sammo/worktrees/0123456789abcdef';
        const commands = buildProfileFrontendCommands(workspaceRoot, buildProfile(), buildCommitSha, {
            NODE_OPTIONS: '--max-old-space-size=1536',
        });

        expect(commands.every((command) => command.env?.NODE_OPTIONS === '--max-old-space-size=1536')).toBe(true);
    });

    it('rejects a non-commit build version before creating cached frontend commands', () => {
        expect(() => buildProfileFrontendCommands('/srv/sammo/worktrees/main', buildProfile(), 'main')).toThrow(
            'Profile frontend build requires a full commit SHA.'
        );
    });
});

describe('buildSharedProfileFrontendCommands', () => {
    const buildCommitSha = '0123456789abcdef0123456789abcdef01234567';

    it('uses one profile-neutral relative-asset build cache key for every profile', () => {
        const commands = buildSharedProfileFrontendCommands(
            '/srv/sammo/worktrees/0123456789abcdef',
            buildCommitSha,
            {
                NODE_OPTIONS: '--max-old-space-size=1536',
                PROFILE_FRONTEND_BUILD_NODE_OPTIONS: '--max-old-space-size=2048',
                VITE_APP_BASE_PATH: '/che',
                VITE_GAME_API_URL: '/che/api/trpc',
                VITE_GAME_SSE_URL: '/che/api/events',
                VITE_GAME_PROFILE: 'che',
                VITE_GATEWAY_API_URL: '/gateway/api/trpc',
            },
            '/srv/sammo/controller'
        );

        expect(commands).toHaveLength(1);
        expect(commands[0]?.env).toMatchObject({
            NODE_OPTIONS: '--max-old-space-size=2048',
            VITE_ASSET_BASE_PATH: './',
            VITE_BUILD_COMMIT_SHA: buildCommitSha,
            VITE_GATEWAY_API_URL: '/gateway/api/trpc',
        });
        expect(commands[0]?.env).not.toHaveProperty('VITE_APP_BASE_PATH');
        expect(commands[0]?.env).not.toHaveProperty('VITE_GAME_API_URL');
        expect(commands[0]?.env).not.toHaveProperty('VITE_GAME_SSE_URL');
        expect(commands[0]?.env).not.toHaveProperty('VITE_GAME_PROFILE');
        expect(commands[0]?.args).toContain('--cache-dir=/srv/sammo/controller/.turbo/release-cache');
    });

    it('rejects a non-commit shared build version', () => {
        expect(() => buildSharedProfileFrontendCommands('/srv/sammo/worktrees/main', 'main')).toThrow(
            'Shared profile frontend build requires a full commit SHA.'
        );
    });
});
