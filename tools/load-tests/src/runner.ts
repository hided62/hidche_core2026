import { execFile } from 'node:child_process';
import { setMaxListeners } from 'node:events';
import { promisify } from 'node:util';
import os from 'node:os';
import { readFile as readTextFile } from 'node:fs/promises';

import { canonicalJson, expandWeightedOperations, sha256, type LoadConfig, type LoadPhase } from './config.js';
import { PhaseMetrics, ProcessSampler, summarizePhaseMetrics, type PhaseMetricSummary } from './metrics.js';
import { runSseConnection } from './sse.js';
import { executeTrpcQuery } from './trpc.js';
import type { DashboardRevisions } from './trpc.js';

const execFileAsync = promisify(execFile);

const wait = (milliseconds: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
        if (signal.aborted) return resolve();
        const done = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        };
        const timer = setTimeout(done, milliseconds);
        signal.addEventListener('abort', done, { once: true });
    });

const loadText = async (file: string): Promise<string | null> => {
    try {
        return (await readTextFile(file, 'utf8')).trim();
    } catch {
        return null;
    }
};

const runtimeAndHost = async () => {
    const cpuQuota = await loadText('/sys/fs/cgroup/cpu.max');
    const memoryLimit = await loadText('/sys/fs/cgroup/memory.max');
    const runtime = { node: process.version, v8: process.versions.v8 };
    const cpus = os.cpus();
    const host = {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        logicalCpuCount: cpus.length,
        cpuModel: cpus[0]?.model ?? 'unknown',
        totalMemoryBytes: os.totalmem(),
        cgroupCpuMax: cpuQuota,
        cgroupMemoryMax: memoryLimit,
    };
    return {
        runtime,
        host,
        runtimeSha256: sha256(canonicalJson(runtime)),
        hostSha256: sha256(canonicalJson(host)),
    };
};

const gitMetadata = async (workspaceRoot: string) => {
    const run = async (args: string[]): Promise<string> =>
        (await execFileAsync('git', args, { cwd: workspaceRoot })).stdout.trim();
    const [commit, tree, status] = await Promise.all([
        run(['rev-parse', 'HEAD']),
        run(['rev-parse', 'HEAD^{tree}']),
        run(['status', '--porcelain=v1']),
    ]);
    return { commit, tree, dirty: status.length > 0 };
};

const runHttpViewers = async (options: {
    config: LoadConfig;
    phase: LoadPhase;
    tokens: readonly string[];
    signal: AbortSignal;
    metrics: PhaseMetrics;
}): Promise<void> => {
    if (options.phase.requestIntervalMs === null || options.phase.operations.length === 0) return;
    const schedule = expandWeightedOperations(options.phase.operations);
    const interval = options.phase.requestIntervalMs;
    await Promise.all(
        options.tokens.map(async (token, viewerIndex) => {
            const stagger = Math.floor((viewerIndex / options.tokens.length) * interval);
            await wait(stagger, options.signal);
            let iteration = 0;
            let dashboardRevisions: DashboardRevisions = {};
            let dashboardSourceRevisions: DashboardRevisions = {};
            while (!options.signal.aborted) {
                const configuredOperation = schedule[(viewerIndex + iteration) % schedule.length]!;
                const operation =
                    configuredOperation.procedure === 'dashboard.getContextBundleDelta' &&
                    Object.keys(dashboardRevisions).length > 0
                        ? {
                              ...configuredOperation,
                              input: {
                                  ...(typeof configuredOperation.input === 'object' &&
                                  configuredOperation.input !== null
                                      ? configuredOperation.input
                                      : {}),
                                  known: dashboardRevisions,
                                  ...(Object.keys(dashboardSourceRevisions).length > 0
                                      ? { knownSource: dashboardSourceRevisions }
                                      : {}),
                                  forceSnapshot: false,
                              },
                          }
                        : configuredOperation;
                const observation = await executeTrpcQuery({
                    baseUrl: options.config.target.baseUrl,
                    trpcPath: options.config.target.trpcPath,
                    operation,
                    token,
                    signal: options.signal,
                    metrics: options.metrics,
                });
                if (observation) {
                    dashboardRevisions = { ...dashboardRevisions, ...observation.revisions };
                    dashboardSourceRevisions = {
                        ...dashboardSourceRevisions,
                        ...observation.sourceRevisions,
                    };
                }
                iteration += 1;
                await wait(interval, options.signal);
            }
        })
    );
};

export interface PhaseResult {
    name: string;
    kind: LoadPhase['kind'];
    configuredDurationMs: number;
    elapsedMs: number;
    metrics: PhaseMetricSummary;
}

const runPhase = async (config: LoadConfig, phase: LoadPhase, tokens: readonly string[]): Promise<PhaseResult> => {
    const metrics = new PhaseMetrics();
    const sampler = new ProcessSampler(metrics);
    const controller = new AbortController();
    setMaxListeners(0, controller.signal);
    let activeConnections = 0;
    const started = performance.now();
    sampler.start();
    const timer = setTimeout(() => controller.abort(), phase.durationMs);
    const sseUrl = new URL(config.target.ssePath, config.target.baseUrl).toString();
    const sseTasks = tokens.slice(0, phase.sseConnections).map((token) =>
        runSseConnection({
            url: sseUrl,
            token,
            signal: controller.signal,
            metrics,
            onActiveChange: (delta) => {
                activeConnections += delta;
                metrics.sseActiveCurrent = activeConnections;
            },
        })
    );
    const httpTask = runHttpViewers({ config, phase, tokens, signal: controller.signal, metrics });
    const settled = await Promise.allSettled([...sseTasks, httpTask]);
    clearTimeout(timer);
    const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (rejected) {
        sampler.stop(activeConnections);
        throw rejected.reason;
    }
    const processSummary = sampler.stop(activeConnections);
    return {
        name: phase.name,
        kind: phase.kind,
        configuredDurationMs: phase.durationMs,
        elapsedMs: Math.round(performance.now() - started),
        metrics: summarizePhaseMetrics(metrics, processSummary),
    };
};

export const describeDryRun = (config: LoadConfig) => ({
    name: config.name,
    targetHost: new URL(config.target.baseUrl).hostname,
    isolation: config.isolation,
    capacity: config.capacity,
    phases: config.phases.map((phase) => ({
        name: phase.name,
        kind: phase.kind,
        durationMs: phase.durationMs,
        sseConnections: phase.sseConnections,
        requestIntervalMs: phase.requestIntervalMs,
        operations: phase.operations.map((operation) => ({ name: operation.name, weight: operation.weight })),
    })),
});

export const runLoadTest = async (options: {
    config: LoadConfig;
    configSha256: string;
    tokens: readonly string[];
    workspaceRoot: string;
}) => {
    const startedAt = new Date().toISOString();
    const [git, environment] = await Promise.all([gitMetadata(options.workspaceRoot), runtimeAndHost()]);
    const phases: PhaseResult[] = [];
    for (const phase of options.config.phases) phases.push(await runPhase(options.config, phase, options.tokens));
    return {
        formatVersion: 1,
        startedAt,
        finishedAt: new Date().toISOString(),
        config: {
            name: options.config.name,
            sha256: options.configSha256,
            capacity: options.config.capacity,
            isolation: options.config.isolation,
        },
        git,
        runtime: environment.runtime,
        host: environment.host,
        hashes: {
            configSha256: options.configSha256,
            runtimeSha256: environment.runtimeSha256,
            hostSha256: environment.hostSha256,
        },
        targetRuntime: options.config.runtimeMetadata,
        phases,
    };
};
