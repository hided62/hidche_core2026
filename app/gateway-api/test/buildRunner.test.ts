import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    buildTurboReleaseCommand,
    MAX_BUILD_OUTPUT_CHARS,
    PnpmBuildRunner,
    resolveReleaseTurboCacheDir,
    resolveReleaseTurboConcurrency,
} from '../src/orchestrator/buildRunner.js';

describe('Turbo release build plan', () => {
    it('anchors the default cache outside commit worktrees and allows an operator override', () => {
        expect(resolveReleaseTurboCacheDir('/srv/core/repository')).toBe('/srv/core/repository/.turbo/release-cache');
        expect(
            resolveReleaseTurboCacheDir('/srv/core/repository', {
                TURBO_CACHE_DIR: '/srv/core/cache/turbo',
            })
        ).toBe('/srv/core/cache/turbo');
        expect(
            resolveReleaseTurboCacheDir('/srv/core/repository', {
                TURBO_CACHE_DIR: '.cache/turbo',
            })
        ).toBe('/srv/core/repository/.cache/turbo');
    });

    it('defaults to one worker for bounded runtimes and accepts a larger-host override', () => {
        expect(resolveReleaseTurboConcurrency()).toBe(1);
        expect(resolveReleaseTurboConcurrency({ RELEASE_TURBO_CONCURRENCY: '2' })).toBe(2);
        expect(() => resolveReleaseTurboConcurrency({ RELEASE_TURBO_CONCURRENCY: '0' })).toThrow(
            'RELEASE_TURBO_CONCURRENCY must be a positive integer.'
        );
    });

    it('uses a bounded streaming Turbo build for the selected packages', () => {
        expect(
            buildTurboReleaseCommand(
                '/srv/core/profile-worktrees/commit',
                '/srv/core/repository',
                ['@sammo-ts/game-api'],
                { NODE_ENV: 'production' }
            )
        ).toEqual({
            command: 'pnpm',
            args: [
                'exec',
                'turbo',
                'run',
                'build',
                '--filter=@sammo-ts/game-api',
                '--cache-dir=/srv/core/repository/.turbo/release-cache',
                '--concurrency=1',
                '--ui=stream',
                '--output-logs=new-only',
            ],
            cwd: '/srv/core/profile-worktrees/commit',
            env: { NODE_ENV: 'production' },
        });
    });
});

describe('PnpmBuildRunner', () => {
    it('returns a failed result when a command cannot be spawned', async () => {
        const runner = new PnpmBuildRunner();

        const result = await runner.run([
            {
                command: path.join(process.cwd(), 'missing-build-command'),
                args: [],
                cwd: process.cwd(),
            },
        ]);

        expect(result.ok).toBe(false);
        expect(result.exitCode).toBeNull();
        expect(result.output).toContain('ENOENT');
    });

    it('retains only a bounded tail across command output', async () => {
        const runner = new PnpmBuildRunner();
        const result = await runner.run([
            {
                command: process.execPath,
                args: ['-e', `process.stdout.write('a'.repeat(${MAX_BUILD_OUTPUT_CHARS}));`],
                cwd: process.cwd(),
            },
            {
                command: process.execPath,
                args: ['-e', "process.stdout.write('tail-marker');"],
                cwd: process.cwd(),
            },
        ]);

        expect(result.ok).toBe(true);
        expect(result.output.length).toBe(MAX_BUILD_OUTPUT_CHARS);
        expect(result.output.endsWith('tail-marker')).toBe(true);
    });

    it('streams command boundaries and line-buffered output to an observer', async () => {
        const runner = new PnpmBuildRunner();
        const events: Array<{ type: string; message?: string }> = [];

        const result = await runner.run(
            [
                {
                    command: process.execPath,
                    args: ['-e', "process.stdout.write('first\\npartial');"],
                    cwd: process.cwd(),
                },
            ],
            async (event) => {
                events.push({ type: event.type, ...('message' in event ? { message: event.message } : {}) });
            }
        );

        expect(result.ok).toBe(true);
        expect(events).toEqual([
            { type: 'COMMAND_START' },
            { type: 'OUTPUT', message: 'first' },
            { type: 'OUTPUT', message: 'partial' },
            { type: 'COMMAND_END' },
        ]);
    });
});
