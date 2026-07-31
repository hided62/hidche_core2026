import { spawn } from 'node:child_process';

export interface BuildCommand {
    command: string;
    args: string[];
    cwd: string;
    env?: Record<string, string>;
}

export interface BuildResult {
    ok: boolean;
    exitCode: number | null;
    output: string;
}

export interface BuildRunner {
    run(commands: BuildCommand[]): Promise<BuildResult>;
}

export const MAX_BUILD_OUTPUT_CHARS = 64 * 1024;

const appendOutputTail = (current: string, chunk: unknown): string =>
    `${current}${String(chunk)}`.slice(-MAX_BUILD_OUTPUT_CHARS);

const runCommand = (command: BuildCommand): Promise<BuildResult> =>
    new Promise((resolve) => {
        const child = spawn(command.command, command.args, {
            cwd: command.cwd,
            env: command.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk) => {
            output = appendOutputTail(output, chunk);
        });
        child.stderr.on('data', (chunk) => {
            output = appendOutputTail(output, chunk);
        });
        child.on('error', (error) => {
            resolve({
                ok: false,
                exitCode: null,
                output: appendOutputTail(output, error.message),
            });
        });
        child.on('close', (code) => {
            resolve({
                ok: code === 0,
                exitCode: code,
                output,
            });
        });
    });

export class PnpmBuildRunner implements BuildRunner {
    async run(commands: BuildCommand[]): Promise<BuildResult> {
        let mergedOutput = '';
        for (const command of commands) {
            const result = await runCommand(command);
            mergedOutput = appendOutputTail(mergedOutput, result.output);
            if (!result.ok) {
                return {
                    ok: false,
                    exitCode: result.exitCode,
                    output: mergedOutput,
                };
            }
        }
        return {
            ok: true,
            exitCode: 0,
            output: mergedOutput,
        };
    }
}
