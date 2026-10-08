import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
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
const RELEASE_BUILD_ENV_NAME =
    /^(?:CI|PATH|NODE_OPTIONS|RELEASE_BUILD_NODE_OPTIONS|PROFILE_FRONTEND_BUILD_NODE_OPTIONS|RAYON_NUM_THREADS|RELEASE_TURBO_CONCURRENCY|TURBO_CACHE_DIR|TZ|VITE_[A-Z0-9_]+)$/u;

export const sanitizeReleaseBuildEnv = (
    env: NodeJS.ProcessEnv | Record<string, string> | undefined
): Record<string, string> => {
    const sanitized = Object.fromEntries(
        Object.entries(env ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string' && RELEASE_BUILD_ENV_NAME.test(entry[0])
        )
    );
    if (sanitized.RELEASE_BUILD_NODE_OPTIONS) {
        sanitized.NODE_OPTIONS = sanitized.RELEASE_BUILD_NODE_OPTIONS;
        delete sanitized.RELEASE_BUILD_NODE_OPTIONS;
    }
    return sanitized;
};

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

interface RemoteBuildMessage {
    event?: BuildProgressEvent;
    result?: BuildResult;
    error?: string;
}

export const MAX_REMOTE_BUILD_FRAME_BYTES = 512 * 1024;
const REMOTE_BUILD_TIMEOUT_MS = 30 * 60 * 1000;
const record = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validRemoteMessage = (value: unknown): value is RemoteBuildMessage => {
    if (!record(value)) return false;
    if (Object.keys(value).length !== 1) return false;
    if (value.result) {
        const result = value.result;
        return (
            record(result) &&
            typeof result.ok === 'boolean' &&
            (!result.ok || (result.exitCode === 0 && result.aborted !== true)) &&
            (result.exitCode === null || (typeof result.exitCode === 'number' && Number.isInteger(result.exitCode))) &&
            typeof result.output === 'string' &&
            result.output.length <= MAX_BUILD_OUTPUT_CHARS &&
            (result.aborted === undefined || typeof result.aborted === 'boolean')
        );
    }
    if (typeof value.error === 'string') return value.error.length <= 2000;
    if (!record(value.event)) return false;
    const event = value.event;
    if (event.type === 'OUTPUT')
        return (
            typeof event.stream === 'string' &&
            ['stdout', 'stderr'].includes(event.stream) &&
            typeof event.message === 'string' &&
            event.message.length <= 2000
        );
    if (
        typeof event.type !== 'string' ||
        !['COMMAND_START', 'COMMAND_END'].includes(event.type) ||
        !record(event.command)
    )
        return false;
    const command = event.command;
    if (
        typeof command.command !== 'string' ||
        !['pnpm', 'node'].includes(command.command) ||
        typeof command.cwd !== 'string' ||
        command.cwd.length > 2048 ||
        !Array.isArray(command.args) ||
        command.args.length > 40 ||
        !command.args.every((arg: unknown) => typeof arg === 'string' && arg.length <= 2048)
    )
        return false;
    if (
        command.env !== undefined &&
        (!record(command.env) ||
            Object.keys(command.env).length > 32 ||
            !Object.values(command.env).every((entry) => typeof entry === 'string' && entry.length <= 8192))
    )
        return false;
    return (
        event.type === 'COMMAND_START' ||
        event.exitCode === null ||
        (typeof event.exitCode === 'number' && Number.isInteger(event.exitCode))
    );
};

const readRemoteBuildToken = (filename: string | undefined): string => {
    try {
        if (!filename || !statSync(filename).isFile() || statSync(filename).size > 256) throw new Error();
        const token = readFileSync(filename, 'utf8').trim();
        if (token.startsWith('replace-with-') || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error();
        return token;
    } catch {
        throw new Error('A valid RELEASE_BUILDER_TOKEN_FILE is required.');
    }
};

export interface RemoteBuildOptions {
    tokenFile?: string;
    timeoutMs?: number;
}

export class RemoteBuildRunner implements BuildRunner {
    private readonly endpoint: string;
    private readonly timeoutMs: number;

    constructor(
        baseUrl: string,
        private readonly fetchImpl: typeof fetch = fetch,
        private readonly config: RemoteBuildOptions = {}
    ) {
        const parsed = new URL('/v1/builds', baseUrl);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
            throw new Error('Invalid release builder endpoint.');
        }
        this.endpoint = parsed.toString();
        this.timeoutMs = config.timeoutMs ?? REMOTE_BUILD_TIMEOUT_MS;
        if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > REMOTE_BUILD_TIMEOUT_MS) {
            throw new Error('Invalid release builder deadline.');
        }
    }

    async run(
        commands: BuildCommand[],
        onProgress?: BuildProgressObserver,
        options?: BuildRunOptions
    ): Promise<BuildResult> {
        let output = '';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        timeout.unref();
        const signal = options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            const token = readRemoteBuildToken(this.config.tokenFile);
            const response = await this.fetchImpl(this.endpoint, {
                method: 'POST',
                redirect: 'error',
                headers: { 'content-type': 'application/json', 'x-release-builder-token': token },
                body: JSON.stringify({
                    commands: commands.map((command) => ({ ...command, env: sanitizeReleaseBuildEnv(command.env) })),
                }),
                signal,
            });
            if (!response.ok || !response.body) {
                await response.body?.cancel().catch(() => undefined);
                return { ok: false, exitCode: null, output: `Release builder returned HTTP ${response.status}.` };
            }
            reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8', { fatal: true });
            let buffer = '';
            let bytes = 0;
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) {
                    buffer += decoder.decode();
                    break;
                }
                bytes += chunk.value.byteLength;
                if (bytes > 64 * 1024 * 1024) throw new Error('Build stream too large.');
                buffer += decoder.decode(chunk.value, { stream: true });
                let newline: number;
                while ((newline = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, newline);
                    buffer = buffer.slice(newline + 1);
                    const result = await this.handleRemoteMessage(line, onProgress);
                    if (result.event?.type === 'OUTPUT') output = appendOutputTail(output, `${result.event.message}\n`);
                    if (result.result) return result.result;
                    if (result.error)
                        return { ok: false, exitCode: null, output: appendOutputTail(output, result.error) };
                }
                if (Buffer.byteLength(buffer) > MAX_REMOTE_BUILD_FRAME_BYTES) throw new Error('Build frame too large.');
            }
            if (buffer.trim()) {
                const result = await this.handleRemoteMessage(buffer, onProgress);
                if (result.result) return result.result;
                if (result.error) return { ok: false, exitCode: null, output: appendOutputTail(output, result.error) };
            }
            return {
                ok: false,
                exitCode: null,
                output: appendOutputTail(output, 'Release builder closed without a result.'),
            };
        } catch {
            const aborted = options?.signal?.aborted ?? false;
            return {
                ok: false,
                exitCode: null,
                output: appendOutputTail(
                    output,
                    aborted ? 'Build cancelled by operator.' : 'Release builder request failed.'
                ),
                ...(aborted ? { aborted: true } : {}),
            };
        } finally {
            clearTimeout(timeout);
            controller.abort();
            await reader?.cancel().catch(() => undefined);
            reader?.releaseLock();
        }
    }

    private async handleRemoteMessage(line: string, onProgress?: BuildProgressObserver): Promise<RemoteBuildMessage> {
        if (!line.trim()) return {};
        if (Buffer.byteLength(line) > MAX_REMOTE_BUILD_FRAME_BYTES)
            return { error: 'Release builder frame is too large.' };
        let message: unknown;
        try {
            message = JSON.parse(line);
        } catch {
            return { error: 'Release builder returned malformed progress data.' };
        }
        if (!validRemoteMessage(message)) return { error: 'Release builder returned invalid progress data.' };
        if (message.error !== undefined) return { error: 'Release builder rejected the build request.' };
        if (message.event && onProgress) await onProgress(message.event);
        return message;
    }
}

export const createReleaseBuildRunner = (
    baseUrl: string | undefined,
    localRunner: BuildRunner,
    fetchImpl: typeof fetch = fetch,
    tokenFile?: string
): BuildRunner => (baseUrl?.trim() ? new RemoteBuildRunner(baseUrl.trim(), fetchImpl, { tokenFile }) : localRunner);
