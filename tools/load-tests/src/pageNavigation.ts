import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

import { chromium, type Page } from '@playwright/test';

import { isPrivateTargetHost, type LoadConfig } from './config.js';
import { summarizeDistribution } from './metrics.js';
import { PhaseMetrics } from './metrics.js';
import { runSseConnection } from './sse.js';

const execFileAsync = promisify(execFile);

const PAGE_ROUTES = [
    { name: 'nation-secret', path: 'nation/secret' },
    { name: 'chief-center', path: 'chief-center' },
    { name: 'current-city', path: 'current-city' },
    { name: 'battle-center', path: 'battle-center' },
    { name: 'nation-finance', path: 'nation/finance' },
] as const;

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const increment = (target: Map<string, number>, key: string): void => {
    target.set(key, (target.get(key) ?? 0) + 1);
};

const mapToObject = (target: ReadonlyMap<string, number>): Record<string, number> =>
    Object.fromEntries([...target.entries()].sort(([left], [right]) => left.localeCompare(right)));

export const parseTrpcProcedures = (requestUrl: string, trpcPath: string): string[] => {
    const pathname = new URL(requestUrl).pathname;
    const prefix = `${trpcPath.replace(/\/$/u, '')}/`;
    if (!pathname.startsWith(prefix)) return [];
    return decodeURIComponent(pathname.slice(prefix.length))
        .split(',')
        .filter((procedure) => /^[A-Za-z][A-Za-z0-9_.]+$/u.test(procedure));
};

type ProcessStat = { cpuTicks: number; rssPages: number; startTicks: number };

const readProcessStat = async (pid: number): Promise<ProcessStat> => {
    const raw = await readFile(`/proc/${pid}/stat`, 'utf8');
    const commandEnd = raw.lastIndexOf(')');
    if (commandEnd < 0) throw new Error('LOAD_TEST_API_PID has an invalid /proc stat record');
    const fields = raw.slice(commandEnd + 2).trim().split(/\s+/u);
    const cpuTicks = Number(fields[11]) + Number(fields[12]);
    const startTicks = Number(fields[19]);
    const rssPages = Number(fields[21]);
    if (![cpuTicks, startTicks, rssPages].every(Number.isFinite)) {
        throw new Error('LOAD_TEST_API_PID has an incomplete /proc stat record');
    }
    return { cpuTicks, startTicks, rssPages };
};

const startApiProcessSampler = async (pid: number, workspaceRoot: string) => {
    const [commandLine, processCwd] = await Promise.all([
        readFile(`/proc/${pid}/cmdline`, 'utf8').then((value) => value.replaceAll('\0', ' ')),
        realpath(`/proc/${pid}/cwd`),
    ]);
    if (!commandLine.includes('game-api') || processCwd !== workspaceRoot) {
        throw new Error('LOAD_TEST_API_PID must be the game-api process from this workspace');
    }
    const [{ stdout: clockText }, { stdout: pageText }, initial] = await Promise.all([
        execFileAsync('getconf', ['CLK_TCK']),
        execFileAsync('getconf', ['PAGESIZE']),
        readProcessStat(pid),
    ]);
    const clockTicks = Number(clockText.trim());
    const pageSize = Number(pageText.trim());
    if (!Number.isFinite(clockTicks) || !Number.isFinite(pageSize)) {
        throw new Error('could not determine process accounting units');
    }
    let sampling = true;
    let maxRssPages = initial.rssPages;
    let samples = 1;
    const startedNs = process.hrtime.bigint();
    const loop = (async () => {
        while (sampling) {
            await wait(250);
            if (!sampling) break;
            const sample = await readProcessStat(pid);
            if (sample.startTicks !== initial.startTicks) throw new Error('game-api process changed during measurement');
            maxRssPages = Math.max(maxRssPages, sample.rssPages);
            samples += 1;
        }
    })();
    return async () => {
        sampling = false;
        await loop;
        const final = await readProcessStat(pid);
        if (final.startTicks !== initial.startTicks) throw new Error('game-api process changed during measurement');
        const elapsedSeconds = Number(process.hrtime.bigint() - startedNs) / 1_000_000_000;
        const cpuSeconds = (final.cpuTicks - initial.cpuTicks) / clockTicks;
        return {
            pid,
            samples,
            elapsedMs: Math.round(elapsedSeconds * 1000),
            cpuSeconds: Math.round(cpuSeconds * 1000) / 1000,
            cpuPercentOfOneCore: Math.round((cpuSeconds / Math.max(elapsedSeconds, 0.001)) * 1000) / 10,
            rssBytes: {
                initial: initial.rssPages * pageSize,
                final: final.rssPages * pageSize,
                max: maxRssPages * pageSize,
            },
        };
    };
};

const readHealth = async (baseUrl: string) => {
    const response = await fetch(new URL('/healthz', baseUrl));
    if (!response.ok) throw new Error(`game-api health returned HTTP ${response.status}`);
    const body = (await response.json()) as Record<string, unknown>;
    const pool = body.postgresPool;
    return {
        ok: body.ok === true,
        postgresPool:
            typeof pool === 'object' && pool !== null
                ? Object.fromEntries(
                      ['max', 'total', 'active', 'idle', 'waiting']
                          .map((key) => [key, (pool as Record<string, unknown>)[key]])
                          .filter(([, value]) => typeof value === 'number')
                  )
                : {},
    };
};

const assertFrontendUrl = (value: string, config: LoadConfig): URL => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !isPrivateTargetHost(url.hostname)) {
        throw new Error('LOAD_TEST_FRONTEND_URL must use HTTP(S) on a private or loopback host');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('LOAD_TEST_FRONTEND_URL must not contain credentials, query, or fragment');
    }
    const expectedSuffix = `/${config.isolation.postgresSchema.split('_')[2] ?? ''}/`;
    if (!url.pathname.endsWith(expectedSuffix)) {
        throw new Error(`LOAD_TEST_FRONTEND_URL must end with the configured profile path ${expectedSuffix}`);
    }
    return url;
};

export const measurePageNavigation = async (options: {
    config: LoadConfig;
    tokens: readonly string[];
    workspaceRoot: string;
    env?: NodeJS.ProcessEnv;
}) => {
    const env = options.env ?? process.env;
    const frontendUrl = assertFrontendUrl(env.LOAD_TEST_FRONTEND_URL ?? '', options.config);
    const apiPid = Number(env.LOAD_TEST_API_PID);
    if (!Number.isSafeInteger(apiPid) || apiPid <= 1) throw new Error('LOAD_TEST_API_PID must be a positive process id');
    if (options.tokens.length !== options.config.capacity.authenticatedViewers) {
        throw new Error('page navigation requires exactly one token per authenticated viewer');
    }
    const dwellMs = Number(env.LOAD_TEST_PAGE_DWELL_MS ?? '1000');
    if (!Number.isSafeInteger(dwellMs) || dwellMs < 250 || dwellMs > 10_000) {
        throw new Error('LOAD_TEST_PAGE_DWELL_MS must be an integer from 250 to 10000');
    }

    const routeLatencyMs = new Map<string, number[]>();
    const routeSuccess = new Map<string, number>();
    const routeErrors = new Map<string, number>();
    const procedureRequests = new Map<string, number>();
    const procedureErrors = new Map<string, number>();
    const procedureLatencyMs = new Map<string, number[]>();
    let pageErrors = 0;
    let permissionErrors = 0;
    const pendingResponses = new Set<Promise<void>>();
    const browser = await chromium.launch({ headless: true });
    const viewers: Array<{ page: Page; close: () => Promise<void> }> = [];
    const activeRouteByPage = new Map<Page, string>();
    let activeSseController: AbortController | null = null;
    let activeSseTasks: Promise<void>[] = [];
    let activeSseSampleTimer: NodeJS.Timeout | null = null;
    const profile = options.config.isolation.postgresSchema.split('_')[2] ?? '';
    try {
        for (const token of options.tokens) {
            const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
            await context.addInitScript(
                ({ accessToken, profileName }) => {
                    const storage = (
                        globalThis as unknown as { localStorage: { setItem: (key: string, value: string) => void } }
                    ).localStorage;
                    storage.setItem('sammo-game-token', accessToken);
                    storage.setItem('sammo-game-profile', profileName);
                },
                { accessToken: token, profileName: profile }
            );
            const page = await context.newPage();
            page.setDefaultTimeout(20_000);
            page.setDefaultNavigationTimeout(20_000);
            await page.goto(new URL('current-city', frontendUrl).toString(), { waitUntil: 'networkidle' });
            const warmupText = await page.locator('body').innerText();
            if (warmupText.includes('권한이 부족합니다')) {
                throw new Error('privileged viewer fixture failed the current-city warmup');
            }
            viewers.push({ page, close: () => context.close() });
        }

        const sseMetrics = new PhaseMetrics();
        const sseController = new AbortController();
        activeSseController = sseController;
        let activeSse = 0;
        sseMetrics.sseActiveConnections.push(0);
        const sseUrl = new URL(options.config.target.ssePath, options.config.target.baseUrl).toString();
        const sseTasks = options.tokens.map((token) =>
            runSseConnection({
                url: sseUrl,
                token,
                signal: sseController.signal,
                metrics: sseMetrics,
                onActiveChange: (delta) => {
                    activeSse += delta;
                    sseMetrics.sseActiveConnections.push(activeSse);
                },
            })
        );
        activeSseTasks = sseTasks;
        const connectionDeadline = Date.now() + 10_000;
        while (activeSse !== options.tokens.length && Date.now() < connectionDeadline) await wait(50);
        if (activeSse !== options.tokens.length) {
            sseController.abort();
            await Promise.allSettled(sseTasks);
            throw new Error(`only ${activeSse} of ${options.tokens.length} SSE connections became active`);
        }

        const healthBefore = await readHealth(options.config.target.baseUrl);
        let scheduledStartAtEpochMs: number | null = null;
        if (env.LOAD_TEST_START_AT_EPOCH_MS) {
            scheduledStartAtEpochMs = Number(env.LOAD_TEST_START_AT_EPOCH_MS);
            if (!Number.isSafeInteger(scheduledStartAtEpochMs)) {
                throw new Error('LOAD_TEST_START_AT_EPOCH_MS must be an integer epoch in milliseconds');
            }
            const waitMs = scheduledStartAtEpochMs - Date.now();
            if (waitMs > 120_000) throw new Error('LOAD_TEST_START_AT_EPOCH_MS must be within the next two minutes');
            if (waitMs > 0) await wait(waitMs);
        }
        const stopApiSampler = await startApiProcessSampler(apiPid, options.workspaceRoot);
        const startedAt = new Date().toISOString();
        const started = performance.now();
        const deadline = started + options.config.capacity.turnIntervalMs;
        const activeSseDuringMeasurement = [activeSse];
        activeSseSampleTimer = setInterval(() => activeSseDuringMeasurement.push(activeSse), 250);

        for (const [viewerIndex, viewer] of viewers.entries()) {
            activeRouteByPage.set(viewer.page, 'warmup');
            viewer.page.on('pageerror', () => {
                pageErrors += 1;
            });
            viewer.page.on('response', (response) => {
                const procedures = parseTrpcProcedures(response.url(), options.config.target.trpcPath);
                if (procedures.length === 0) return;
                const task = (async () => {
                    await response.finished().catch(() => null);
                    const timing = response.request().timing();
                    const latencyMs = timing.responseEnd;
                    for (const procedure of procedures) {
                        const key = `${activeRouteByPage.get(viewer.page) ?? 'unknown'}:${procedure}`;
                        increment(procedureRequests, key);
                        if (response.status() >= 400) increment(procedureErrors, `${key}:http-${response.status()}`);
                        if (latencyMs >= 0) {
                            const values = procedureLatencyMs.get(key) ?? [];
                            values.push(latencyMs);
                            procedureLatencyMs.set(key, values);
                        }
                    }
                })().finally(() => pendingResponses.delete(task));
                pendingResponses.add(task);
            });
            void viewerIndex;
        }

        await Promise.all(
            viewers.map(async ({ page }, viewerIndex) => {
                let iteration = 0;
                while (performance.now() < deadline) {
                    const route = PAGE_ROUTES[(viewerIndex + iteration) % PAGE_ROUTES.length]!;
                    activeRouteByPage.set(page, route.name);
                    const routeStarted = performance.now();
                    try {
                        await page.goto(new URL(route.path, frontendUrl).toString(), { waitUntil: 'networkidle' });
                        const bodyText = await page.locator('body').innerText();
                        if (bodyText.includes('권한이 부족합니다')) {
                            permissionErrors += 1;
                            increment(routeErrors, `${route.name}:permission`);
                        } else {
                            increment(routeSuccess, route.name);
                        }
                    } catch {
                        increment(routeErrors, `${route.name}:navigation`);
                    } finally {
                        const values = routeLatencyMs.get(route.name) ?? [];
                        values.push(performance.now() - routeStarted);
                        routeLatencyMs.set(route.name, values);
                    }
                    iteration += 1;
                    if (performance.now() < deadline) await wait(dwellMs);
                }
            })
        );
        clearInterval(activeSseSampleTimer);
        activeSseSampleTimer = null;
        activeSseDuringMeasurement.push(activeSse);
        await Promise.allSettled([...pendingResponses]);
        const apiProcess = await stopApiSampler();
        const elapsedMs = Math.round(performance.now() - started);
        const healthAfter = await readHealth(options.config.target.baseUrl);
        sseController.abort();
        await Promise.allSettled(sseTasks);
        sseMetrics.sseActiveConnections.push(activeSse);

        return {
            formatVersion: 1,
            startedAt,
            finishedAt: new Date().toISOString(),
            configuredDurationMs: options.config.capacity.turnIntervalMs,
            elapsedMs,
            scheduling: {
                scheduledStartAtEpochMs,
                actualStartAtEpochMs: Date.parse(startedAt),
                startDelayMs:
                    scheduledStartAtEpochMs === null ? null : Math.max(0, Date.parse(startedAt) - scheduledStartAtEpochMs),
            },
            fixture: {
                name: options.config.name,
                viewers: options.tokens.length,
                npcGenerals: options.config.capacity.npcGenerals,
                pageDwellMs: dwellMs,
            },
            browser: {
                name: 'chromium',
                contexts: viewers.length,
                viewport: { width: 1280, height: 900 },
                routes: Object.fromEntries(
                    PAGE_ROUTES.map((route) => [
                        route.name,
                        {
                            success: routeSuccess.get(route.name) ?? 0,
                            latencyMs: summarizeDistribution(routeLatencyMs.get(route.name) ?? []),
                        },
                    ])
                ),
                routeErrors: mapToObject(routeErrors),
                pageErrors,
                permissionErrors,
            },
            trpc: {
                requests: mapToObject(procedureRequests),
                errors: mapToObject(procedureErrors),
                latencyMs: Object.fromEntries(
                    [...procedureLatencyMs.entries()]
                        .sort(([left], [right]) => left.localeCompare(right))
                        .map(([key, values]) => [key, summarizeDistribution(values)])
                ),
            },
            sse: {
                attempts: sseMetrics.sseAttempts,
                opened: sseMetrics.sseOpened,
                closed: sseMetrics.sseClosed,
                reconnects: sseMetrics.sseReconnects,
                failures: sseMetrics.sseFailures,
                privacyViolations: sseMetrics.ssePrivacyViolations,
                events: mapToObject(sseMetrics.sseEvents),
                activeConnections: summarizeDistribution(activeSseDuringMeasurement),
            },
            server: {
                healthBefore,
                healthAfter,
                apiProcess,
            },
        };
    } finally {
        if (activeSseSampleTimer) clearInterval(activeSseSampleTimer);
        activeSseController?.abort();
        await Promise.allSettled(activeSseTasks);
        await Promise.allSettled(viewers.map((viewer) => viewer.close()));
        await browser.close();
    }
};
