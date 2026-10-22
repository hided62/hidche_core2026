import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    RemoteBuildRunner,
    sanitizeReleaseBuildEnv,
    type BuildProgressEvent,
} from '../src/orchestrator/buildRunner.js';

describe('sanitizeReleaseBuildEnv', () => {
    it('keeps only public build controls and frontend values', () => {
        expect(
            sanitizeReleaseBuildEnv({
                CI: 'true',
                NODE_OPTIONS: '--max-old-space-size=1024',
                VITE_APP_BASE_PATH: '/gateway',
                GAME_TOKEN_SECRET: 'secret',
                DATABASE_URL: 'postgresql://private',
                REDIS_URL: 'redis://private',
                PATH: '/private/path',
            })
        ).toEqual({
            CI: 'true',
            PATH: '/private/path',
            NODE_OPTIONS: '--max-old-space-size=1024',
            VITE_APP_BASE_PATH: '/gateway',
        });
        expect(
            sanitizeReleaseBuildEnv({
                NODE_OPTIONS: '--max-old-space-size=1536',
                RELEASE_BUILD_NODE_OPTIONS: '--max-old-space-size=3072',
            })
        ).toEqual({ NODE_OPTIONS: '--max-old-space-size=3072' });
    });
});

describe('RemoteBuildRunner', () => {
    let directory: string;
    let tokenFile: string;
    beforeAll(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'builder-token-test-'));
        tokenFile = path.join(directory, 'token');
        await fs.writeFile(tokenFile, 't'.repeat(64), { mode: 0o600 });
    });
    afterAll(async () => {
        await fs.rm(directory, { recursive: true, force: true });
    });
    it('streams progress and returns the builder result without sending secrets', async () => {
        const messages = [
            { event: { type: 'OUTPUT', stream: 'stdout', message: 'building' } },
            { result: { ok: true, exitCode: 0, output: 'building' } },
        ];
        const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
            expect(new Headers(init?.headers).get('x-release-builder-token')).toBe('t'.repeat(64));
            expect(init?.redirect).toBe('error');
            const request = JSON.parse(String(init?.body)) as {
                commands: Array<{ env: Record<string, string> }>;
            };
            expect(request.commands[0].env).toEqual({ VITE_APP_BASE_PATH: '/gateway' });
            return new Response(`${messages.map((message) => JSON.stringify(message)).join('\n')}\n`, {
                status: 200,
            });
        }) as unknown as typeof fetch;
        const progress: BuildProgressEvent[] = [];
        const result = await new RemoteBuildRunner('http://builder:15100', fetchImpl, { tokenFile }).run(
            [
                {
                    command: 'pnpm',
                    args: ['exec', 'turbo', 'run', 'build'],
                    cwd: '/srv/core/repository',
                    env: { VITE_APP_BASE_PATH: '/gateway', GAME_TOKEN_SECRET: 'do-not-send' },
                },
            ],
            (event) => {
                progress.push(event);
            }
        );
        expect(result).toEqual({ ok: true, exitCode: 0, output: 'building' });
        expect(progress).toEqual([{ type: 'OUTPUT', stream: 'stdout', message: 'building' }]);
    });
});
