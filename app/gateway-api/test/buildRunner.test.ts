import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MAX_BUILD_OUTPUT_CHARS, PnpmBuildRunner } from '../src/orchestrator/buildRunner.js';

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
