import { spawn } from 'node:child_process';
import path from 'node:path';

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
    aborted?: boolean;
}

export type BuildProgressEvent =
    | { type: 'COMMAND_START'; command: BuildCommand }
    | { type: 'OUTPUT'; stream: 'stdout' | 'stderr'; message: string }
    | { type: 'COMMAND_END'; command: BuildCommand; exitCode: number | null };

export type BuildProgressObserver = (event: BuildProgressEvent) => void | Promise<void>;

export interface BuildRunOptions {
    signal?: AbortSignal;
    terminateGraceMs?: number;
}

export interface BuildRunner {
    run(commands: BuildCommand[], onProgress?: BuildProgressObserver, options?: BuildRunOptions): Promise<BuildResult>;
}

export const MAX_BUILD_OUTPUT_CHARS = 64 * 1024;
const DEFAULT_RELEASE_TURBO_CONCURRENCY = 1;

export const resolveReleaseTurboConcurrency = (env?: Record<string, string>): number => {
    const configured = env?.RELEASE_TURBO_CONCURRENCY?.trim();
    if (!configured) return DEFAULT_RELEASE_TURBO_CONCURRENCY;
    const parsed = Number(configured);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('RELEASE_TURBO_CONCURRENCY must be a positive integer.');
    }
    return parsed;
};

export const resolveReleaseTurboCacheDir = (cacheAnchorRoot: string, env?: Record<string, string>): string => {
    const configured = env?.TURBO_CACHE_DIR?.trim();
    if (!configured) return path.join(path.resolve(cacheAnchorRoot), '.turbo', 'release-cache');
    return path.isAbsolute(configured) ? configured : path.resolve(cacheAnchorRoot, configured);
};

export const buildTurboReleaseCommand = (
    workspaceRoot: string,
    cacheAnchorRoot: string,
    packageNames: string[],
    env?: Record<string, string>
): BuildCommand => buildTurboReleaseTaskCommand(workspaceRoot, cacheAnchorRoot, 'build', packageNames, env);

export const buildTurboReleaseTaskCommand = (
    workspaceRoot: string,
    cacheAnchorRoot: string,
    taskName: string,
    packageNames: string[],
    env?: Record<string, string>
): BuildCommand => ({
    command: 'pnpm',
    args: [
        'exec',
        'turbo',
        'run',
        taskName,
        ...packageNames.map((packageName) => `--filter=${packageName}`),
        `--cache-dir=${resolveReleaseTurboCacheDir(cacheAnchorRoot, env)}`,
        `--concurrency=${resolveReleaseTurboConcurrency(env)}`,
        '--ui=stream',
        '--output-logs=new-only',
    ],
    cwd: workspaceRoot,
    env,
});

const appendOutputTail = (current: string, chunk: unknown): string =>
    `${current}${String(chunk)}`.slice(-MAX_BUILD_OUTPUT_CHARS);

const terminateChildProcess = (pid: number | undefined, signal: NodeJS.Signals): void => {
    if (!pid) return;
    try {
        if (process.platform !== 'win32') {
            process.kill(-pid, signal);
            return;
        }
    } catch {
        // Fall back to the direct child below when the process group already exited.
    }
    try {
        process.kill(pid, signal);
    } catch {
        // The child already exited.
    }
};

const runCommand = (
    command: BuildCommand,
    onProgress?: BuildProgressObserver,
    options?: BuildRunOptions
): Promise<BuildResult> =>
    new Promise((resolve) => {
        let progressQueue = Promise.resolve();
        const emit = (event: BuildProgressEvent) => {
            if (!onProgress) return;
            progressQueue = progressQueue.then(() => onProgress(event)).catch(() => undefined);
        };
        emit({ type: 'COMMAND_START', command });
        const child = spawn(command.command, command.args, {
            cwd: command.cwd,
            env: command.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
        });
        let output = '';
        let spawnFailed = false;
        let aborted = false;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const abort = () => {
            if (aborted) return;
            aborted = true;
            output = appendOutputTail(output, '\nBuild cancelled by operator.');
            terminateChildProcess(child.pid, 'SIGTERM');
            killTimer = setTimeout(
                () => terminateChildProcess(child.pid, 'SIGKILL'),
                options?.terminateGraceMs ?? 5_000
            );
            killTimer.unref?.();
        };
        options?.signal?.addEventListener('abort', abort, { once: true });
        if (options?.signal?.aborted) abort();
        const lineBuffers = { stdout: '', stderr: '' };
        const emitOutput = (stream: 'stdout' | 'stderr', chunk: unknown, flush = false) => {
            if (flush && !lineBuffers[stream]) return;
            lineBuffers[stream] += String(chunk);
            const lines = lineBuffers[stream].split(/\r?\n/u);
            lineBuffers[stream] = flush ? '' : (lines.pop() ?? '');
            if (flush && lineBuffers[stream]) lines.push(lineBuffers[stream]);
            for (const line of lines) {
                for (let offset = 0; offset < line.length || (offset === 0 && line.length === 0); offset += 2_000) {
                    emit({ type: 'OUTPUT', stream, message: line.slice(offset, offset + 2_000) });
                    if (line.length === 0) break;
                }
            }
        };
        child.stdout.on('data', (chunk) => {
            output = appendOutputTail(output, chunk);
            emitOutput('stdout', chunk);
        });
        child.stderr.on('data', (chunk) => {
            output = appendOutputTail(output, chunk);
            emitOutput('stderr', chunk);
        });
        child.on('error', (error) => {
            spawnFailed = true;
            output = appendOutputTail(output, error.message);
        });
        child.on('close', (code) => {
            options?.signal?.removeEventListener('abort', abort);
            if (killTimer) clearTimeout(killTimer);
            emitOutput('stdout', '', true);
            emitOutput('stderr', '', true);
            const exitCode = spawnFailed ? null : code;
            emit({ type: 'COMMAND_END', command, exitCode });
            void progressQueue.then(() => {
                resolve({
                    ok: !aborted && !spawnFailed && code === 0,
                    exitCode,
                    output,
                    ...(aborted ? { aborted: true } : {}),
                });
            });
        });
    });

export class PnpmBuildRunner implements BuildRunner {
    async run(
        commands: BuildCommand[],
        onProgress?: BuildProgressObserver,
        options?: BuildRunOptions
    ): Promise<BuildResult> {
        let mergedOutput = '';
        for (const command of commands) {
            if (options?.signal?.aborted) {
                return {
                    ok: false,
                    exitCode: null,
                    output: appendOutputTail(mergedOutput, 'Build cancelled by operator.'),
                    aborted: true,
                };
            }
            const result = await runCommand(command, onProgress, options);
            mergedOutput = appendOutputTail(mergedOutput, result.output);
            if (!result.ok) {
                return {
                    ok: false,
                    exitCode: result.exitCode,
                    output: mergedOutput,
                    ...(result.aborted ? { aborted: true } : {}),
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
