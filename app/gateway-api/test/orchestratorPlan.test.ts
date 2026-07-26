import { describe, expect, it } from 'vitest';

import path from 'node:path';

import {
    buildProcessDefinitions,
    buildWorkspaceCommands,
    planProfileReconcile,
} from '../src/orchestrator/gatewayOrchestrator.js';
import type { GatewayProfileRecord } from '../src/orchestrator/profileRepository.js';

const buildProfile = (buildWorkspace?: string): GatewayProfileRecord => ({
    profileName: 'che:2',
    profile: 'che',
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
                apiRunning: true,
                daemonRunning: false,
                battleSimRunning: true,
                tournamentRunning: true,
            })
        ).toEqual({ shouldStart: true, shouldStop: false });
    });

    it('starts processes for preopen profiles', () => {
        expect(
            planProfileReconcile('PREOPEN', {
                apiRunning: false,
                daemonRunning: false,
                battleSimRunning: false,
                tournamentRunning: false,
            })
        ).toEqual({ shouldStart: true, shouldStop: false });
    });

    it('does nothing when running profile is healthy', () => {
        expect(
            planProfileReconcile('RUNNING', {
                apiRunning: true,
                daemonRunning: true,
                battleSimRunning: true,
                tournamentRunning: true,
            })
        ).toEqual({ shouldStart: false, shouldStop: false });
    });

    it('stops processes for non-running profiles', () => {
        expect(
            planProfileReconcile('STOPPED', {
                apiRunning: false,
                daemonRunning: true,
                battleSimRunning: false,
                tournamentRunning: false,
            })
        ).toEqual({ shouldStart: false, shouldStop: true });
    });

    it('keeps reserved profiles off', () => {
        expect(
            planProfileReconcile('RESERVED', {
                apiRunning: false,
                daemonRunning: false,
                battleSimRunning: false,
                tournamentRunning: false,
            })
        ).toEqual({ shouldStart: false, shouldStop: false });
    });
});

describe('buildProcessDefinitions', () => {
    const processConfig = {
        workspaceRoot: '/srv/sammo/main',
        redisKeyPrefix: 'sammo:gateway',
        gameTokenSecret: 'test-secret',
    };

    it('runs a built profile from its commit worktree', () => {
        const buildWorkspace = '/srv/sammo/worktrees/0123456789abcdef';
        const definitions = buildProcessDefinitions(buildProfile(buildWorkspace), processConfig);

        expect(definitions.api.cwd).toBe(path.join(buildWorkspace, 'app', 'game-api'));
        expect(definitions.api.script).toBe(path.join(buildWorkspace, 'app', 'game-api', 'dist', 'index.js'));
        expect(definitions.api.env).toMatchObject({
            GAME_TRPC_PATH: '/che/api/trpc',
            GAME_API_EVENTS_PATH: '/che/api/events',
            GAME_UPLOAD_PATH: '/che/api/uploads',
        });
        expect(definitions.daemon.cwd).toBe(path.join(buildWorkspace, 'app', 'game-engine'));
        expect(definitions.daemon.script).toBe(path.join(buildWorkspace, 'app', 'game-engine', 'dist', 'index.js'));
        expect(definitions.battleSim).toMatchObject({
            cwd: path.join(buildWorkspace, 'app', 'game-api'),
            script: path.join(buildWorkspace, 'app', 'game-api', 'dist', 'index.js'),
            env: { GAME_API_ROLE: 'battle-sim-worker' },
        });
        expect(definitions.tournament).toMatchObject({
            cwd: path.join(buildWorkspace, 'app', 'game-api'),
            script: path.join(buildWorkspace, 'app', 'game-api', 'dist', 'index.js'),
            env: { GAME_API_ROLE: 'tournament-worker' },
        });
    });

    it('keeps main as the runtime for profiles without a commit worktree', () => {
        const definitions = buildProcessDefinitions(buildProfile(), processConfig);

        expect(definitions.api.cwd).toBe(path.join(processConfig.workspaceRoot, 'app', 'game-api'));
        expect(definitions.daemon.cwd).toBe(path.join(processConfig.workspaceRoot, 'app', 'game-engine'));
        expect(definitions.battleSim.cwd).toBe(path.join(processConfig.workspaceRoot, 'app', 'game-api'));
        expect(definitions.tournament.cwd).toBe(path.join(processConfig.workspaceRoot, 'app', 'game-api'));
    });
});

describe('buildWorkspaceCommands', () => {
    it('installs and builds runtime dependencies before the profile processes', () => {
        const workspaceRoot = '/srv/sammo/worktrees/0123456789abcdef';
        const commands = buildWorkspaceCommands(workspaceRoot, true);

        expect(commands.map(({ args }) => args)).toEqual([
            ['install'],
            ['--filter', '@sammo-ts/common', 'build'],
            ['--filter', '@sammo-ts/infra', 'prisma:generate'],
            ['--filter', '@sammo-ts/infra', 'build'],
            ['--filter', '@sammo-ts/logic', 'build'],
            ['--filter', '@sammo-ts/game-api', 'build'],
            ['--filter', '@sammo-ts/game-engine', 'build'],
        ]);
        expect(commands.every(({ cwd }) => cwd === workspaceRoot)).toBe(true);
    });
});
