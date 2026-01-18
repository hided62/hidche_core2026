import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';

import type { AppRouter as GatewayAppRouter } from '@sammo-ts/gateway-api';
import type { AppRouter as GameAppRouter } from '@sammo-ts/game-api';
import { createGatewayApiServer } from '@sammo-ts/gateway-api';
import { Pm2ProcessManager } from '../../../app/gateway-api/src/orchestrator/pm2ProcessManager.js';
import {
    createGatewayPostgresConnector,
    createGamePostgresConnector,
    resolvePostgresConfigFromEnv,
    createRedisConnector,
    resolveRedisConfigFromEnv,
} from '@sammo-ts/infra';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const parseEnvFile = (rawText: string): Record<string, string> => {
    const env: Record<string, string> = {};
    const lines = rawText.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const index = trimmed.indexOf('=');
        if (index < 0) {
            continue;
        }
        const key = trimmed.slice(0, index).trim();
        let value = trimmed.slice(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    return env;
};

const loadEnv = async () => {
    const envPath = path.join(workspaceRoot, '.env.ci');
    const raw = await fs.readFile(envPath, 'utf8');
    const values = parseEnvFile(raw);
    for (const [key, value] of Object.entries(values)) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
    process.env.INTEGRATION_JOIN_ALLOW_CITY ??= 'true';
    process.env.INTEGRATION_WORLD_SEED ??= 'integration-seed';
    process.env.GATEWAY_WORKSPACE_ROOT ??= workspaceRoot;
    process.env.GATEWAY_WORKTREE_ROOT ??= path.join(workspaceRoot, '.worktrees-test');
    process.env.GATEWAY_DB_SCHEMA ??= 'public';
    process.env.GATEWAY_API_PORT ??= '13000';
    process.env.GAME_API_PORT ??= '14000';
};

const execCommand = (command: string, args: string[], env?: NodeJS.ProcessEnv) =>
    new Promise<void>((resolve, reject) => {
        execFile(command, args, { env, cwd: workspaceRoot }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`${command} ${args.join(' ')} failed:\n${stdout}\n${stderr}`));
                return;
            }
            resolve();
        });
    });

const ensureSchema = async (schema: string) => {
    const adminUrl = resolvePostgresConfigFromEnv({ schema: 'public' }).url;
    const connector = createGatewayPostgresConnector({ url: adminUrl });
    await connector.connect();
    try {
        await connector.prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    } finally {
        await connector.disconnect();
    }
};

const truncateSchema = async (schema: string) => {
    const adminUrl = resolvePostgresConfigFromEnv({ schema: 'public' }).url;
    const connector = createGatewayPostgresConnector({ url: adminUrl });
    await connector.connect();
    try {
        const rows = (await connector.prisma.$queryRawUnsafe(
            `SELECT tablename FROM pg_tables WHERE schemaname = '${schema}'`
        )) as Array<{ tablename: string }>;
        if (rows.length === 0) {
            return;
        }
        const tableList = rows.map((row) => `"${schema}"."${row.tablename}"`).join(', ');
        await connector.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
    } finally {
        await connector.disconnect();
    }
};

const resetDatabase = async (profile: string) => {
    await ensureSchema('public');
    await ensureSchema(profile);
    await execCommand('pnpm', ['--filter', '@sammo-ts/infra', 'prisma:db:push:gateway', '--accept-data-loss'], {
        ...process.env,
        POSTGRES_SCHEMA: 'public',
    });
    await execCommand('pnpm', ['--filter', '@sammo-ts/infra', 'prisma:db:push:game', '--accept-data-loss'], {
        ...process.env,
        POSTGRES_SCHEMA: profile,
    });
    await truncateSchema('public');
    await truncateSchema(profile);
};

const resetRedis = async () => {
    const redis = createRedisConnector(resolveRedisConfigFromEnv());
    await redis.connect();
    try {
        await redis.client.flushDb();
    } finally {
        await redis.disconnect();
    }
};

const ensureBuildArtifacts = async () => {
    const required = [
        path.join(workspaceRoot, 'app', 'game-api', 'dist', 'index.js'),
        path.join(workspaceRoot, 'app', 'game-engine', 'dist', 'index.js'),
    ];
    for (const filePath of required) {
        try {
            await fs.access(filePath);
        } catch {
            throw new Error(`Missing build artifact: ${filePath}. Run pnpm build first.`);
        }
    }
};

const createGatewayClient = (baseUrl: string, trpcPath: string, sessionTokenRef: { value?: string }) =>
    createTRPCProxyClient<GatewayAppRouter>({
        links: [
            httpBatchLink({
                url: `${baseUrl}${trpcPath}`,
                headers: () =>
                    sessionTokenRef.value
                        ? {
                              'x-session-token': sessionTokenRef.value,
                          }
                        : {},
            }),
        ],
    });

const createGameClient = (baseUrl: string, trpcPath: string, accessTokenRef: { value?: string }) =>
    createTRPCProxyClient<GameAppRouter>({
        links: [
            httpBatchLink({
                url: `${baseUrl}${trpcPath}`,
                headers: () =>
                    accessTokenRef.value
                        ? {
                              authorization: `Bearer ${accessTokenRef.value}`,
                          }
                        : {},
            }),
        ],
    });

const buildProcessName = (profileName: string, role: 'api' | 'daemon'): string =>
    `sammo:${profileName}:${role === 'api' ? 'game-api' : 'turn-daemon'}`;

const waitForPm2Online = async (manager: Pm2ProcessManager, names: string[], timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await manager.list();
        const statusMap = new Map(list.map((process) => [process.name, process.status]));
        if (names.every((name) => statusMap.get(name) === 'online')) {
            return;
        }
        await sleep(500);
    }
    throw new Error(`PM2 processes did not reach online: ${names.join(', ')}`);
};

const cleanupPm2 = async (manager: Pm2ProcessManager, names: string[]) => {
    for (const name of names) {
        try {
            await manager.stop(name);
        } catch {}
        try {
            await manager.delete(name);
        } catch {}
    }
};

const waitForTurnDaemonStatus = async (
    gameClient: ReturnType<typeof createGameClient>,
    timeoutMs = 10_000
) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const status = await gameClient.turnDaemon.status.query({ timeoutMs: 3000 });
        if (status) {
            return status;
        }
        await sleep(200);
    }
    throw new Error('turn daemon status timeout');
};

const runTurn = async (gameClient: ReturnType<typeof createGameClient>) => {
    const status = await waitForTurnDaemonStatus(gameClient);
    const prevRunAt = status.lastRunAt;
    const targetTime = status.nextTurnTime
        ? new Date(new Date(status.nextTurnTime).getTime() + 5 * 60_000).toISOString()
        : new Date(Date.now() + 5 * 60_000).toISOString();
    await gameClient.turnDaemon.run.mutate({
        reason: 'manual',
        targetTime,
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        const nextStatus = await waitForTurnDaemonStatus(gameClient);
        if (!nextStatus.running && nextStatus.lastRunAt && nextStatus.lastRunAt !== prevRunAt) {
            return nextStatus;
        }
        await sleep(200);
    }
    throw new Error('turn run timeout');
};

const parseSseFrame = (raw: string): { event?: string; data?: string } | null => {
    if (!raw.trim()) {
        return null;
    }
    const lines = raw.split(/\r?\n/);
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of lines) {
        if (line.startsWith('event:')) {
            event = line.slice(6).trim();
            continue;
        }
        if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
        }
    }
    if (!event && dataLines.length === 0) {
        return null;
    }
    return { event, data: dataLines.join('\n') };
};

const waitForSseEvent = async (options: {
    url: string;
    token: string;
    eventName: string;
    timeoutMs?: number;
    minAtMs?: number;
}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
        const parsedUrl = new URL(options.url);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        let settled = false;
        let timer: NodeJS.Timeout | null = null;
        const request = client.request(
            parsedUrl,
            {
                headers: {
                    authorization: `Bearer ${options.token}`,
                },
            },
            (response) => {
                if (response.statusCode && response.statusCode >= 400) {
                    cleanup();
                    settled = true;
                    reject(new Error(`SSE request failed with ${response.statusCode}`));
                    response.resume();
                    return;
                }
                response.setEncoding('utf8');
                let buffer = '';
                const onData = (chunk: string) => {
                    buffer += chunk;
                    let index = buffer.indexOf('\n\n');
                    while (index >= 0) {
                        const rawFrame = buffer.slice(0, index);
                        buffer = buffer.slice(index + 2);
                        const frame = parseSseFrame(rawFrame);
                        if (!frame || frame.event !== options.eventName || !frame.data) {
                            index = buffer.indexOf('\n\n');
                            continue;
                        }
                        try {
                            const parsed = JSON.parse(frame.data) as Record<string, unknown>;
                            if (typeof options.minAtMs === 'number') {
                                const at = typeof parsed.at === 'string' ? new Date(parsed.at).getTime() : NaN;
                                if (Number.isFinite(at) && at < options.minAtMs) {
                                    index = buffer.indexOf('\n\n');
                                    continue;
                                }
                            }
                            cleanup();
                            settled = true;
                            resolve(parsed);
                            return;
                        } catch (error) {
                            cleanup();
                            settled = true;
                            reject(error);
                            return;
                        }
                    }
                };
                response.on('data', onData);
                response.on('end', () => {
                    if (settled) {
                        return;
                    }
                    cleanup();
                    settled = true;
                    reject(new Error('SSE connection closed before event'));
                });
            }
        );

        const cleanup = () => {
            if (timer) {
                clearTimeout(timer);
            }
            request.destroy();
        };

        request.on('error', (error) => {
            if (settled) {
                return;
            }
            cleanup();
            settled = true;
            reject(error);
        });
        request.end();

        timer = setTimeout(() => {
            if (settled) {
                return;
            }
            cleanup();
            settled = true;
            reject(new Error('SSE timeout'));
        }, options.timeoutMs ?? 30_000);
    });

describe('pm2 orchestrator e2e', () => {
    let gatewayServer: Awaited<ReturnType<typeof createGatewayApiServer>> | null = null;
    let pm2Manager: Pm2ProcessManager | null = null;
    let profile = 'che';
    let scenario = '2';
    let scenarioId = 2;
    let profileName = 'che:2';
    let apiPort = 14000;
    let processNames: string[] = [];

    beforeAll(async () => {
        await loadEnv();
        process.chdir(workspaceRoot);
        await ensureBuildArtifacts();

        profile = process.env.PROFILE ?? 'che';
        scenario = process.env.SCENARIO ?? '2';
        scenarioId = Number(scenario);
        if (!Number.isFinite(scenarioId)) {
            throw new Error(`SCENARIO must be numeric, got ${scenario}`);
        }
        profileName = `${profile}:${scenario}`;
        apiPort = Number(process.env.GAME_API_PORT ?? '14000');
        processNames = [buildProcessName(profileName, 'api'), buildProcessName(profileName, 'daemon')];

        await resetDatabase(profile);
        await resetRedis();

        pm2Manager = new Pm2ProcessManager();
        await cleanupPm2(pm2Manager, processNames);

        gatewayServer = await createGatewayApiServer();
        await gatewayServer.app.listen({
            host: gatewayServer.config.host,
            port: gatewayServer.config.port,
        });
    }, 60_000);

    afterAll(async () => {
        if (pm2Manager) {
            await cleanupPm2(pm2Manager, processNames);
        }
        if (gatewayServer) {
            await gatewayServer.app.close();
        }
    }, 30_000);

    it('starts game-api/turn-daemon via PM2 and serves commands', async () => {
        if (!gatewayServer || !pm2Manager) {
            throw new Error('test setup failed');
        }
        const bootstrapToken = process.env.GATEWAY_BOOTSTRAP_TOKEN ?? '';
        if (!bootstrapToken) {
            throw new Error('GATEWAY_BOOTSTRAP_TOKEN is required for bootstrapLocal');
        }

        const gatewayUrl = `http://localhost:${gatewayServer.config.port}`;
        const gameUrl = `http://localhost:${apiPort}`;
        const adminSessionRef: { value?: string } = {};
        const accessTokenRef: { value?: string } = {};
        const gatewayClient = createGatewayClient(gatewayUrl, gatewayServer.config.trpcPath, adminSessionRef);
        const gameClientPublic = createGameClient(gameUrl, process.env.TRPC_PATH ?? '/trpc', { value: undefined });
        const gameClientAuthed = createGameClient(gameUrl, process.env.TRPC_PATH ?? '/trpc', accessTokenRef);

        const bootstrap = await gatewayClient.auth.bootstrapLocal.mutate({
            token: bootstrapToken,
            username: 'admin',
            password: 'admin-pass-123',
            displayName: 'Admin',
        });
        adminSessionRef.value = bootstrap.sessionToken;
        expect(bootstrap.user.username).toBe('admin');

        await gatewayClient.admin.users.createLocal.mutate({
            username: 'e2e-user',
            password: 'e2e-pass-123',
            displayName: 'IntegrationUser',
        });

        await gatewayClient.admin.profiles.upsert.mutate({
            profile,
            scenario,
            apiPort,
            status: 'RUNNING',
        });

        await gatewayClient.admin.profiles.installNow.mutate({
            profileName,
            install: {
                scenarioId,
                turnTermMinutes: 1,
                sync: false,
                fiction: 0,
                extend: true,
                blockGeneralCreate: 0,
                npcMode: 0,
                showImgLevel: 0,
                tournamentTrig: false,
                joinMode: 'full',
                autorunUser: null,
            },
        });

        await gatewayClient.admin.profiles.reconcileNow.mutate();

        await waitForPm2Online(pm2Manager, processNames);

        await waitForTurnDaemonStatus(gameClientPublic);

        const login = await gatewayClient.auth.login.mutate({
            username: 'e2e-user',
            password: 'e2e-pass-123',
        });

        const gameSession = await gatewayClient.auth.issueGameSession.mutate({
            sessionToken: login.sessionToken,
            profile: profileName,
        });

        const access = await gameClientPublic.auth.exchangeGatewayToken.mutate({
            gatewayToken: gameSession.gameToken,
        });
        accessTokenRef.value = access.accessToken;

        const publicMap = await gameClientPublic.public.getCachedMap.query();
        expect(publicMap.result).toBe(true);
        const cityCandidates = publicMap.cityList
            .map((row: number[]) => ({
                id: row[0],
                level: row[1],
                nationId: row[3],
            }))
            .filter(
                (city: { id: number; level: number; nationId: number }) =>
                    (city.level === 5 || city.level === 6) && city.nationId === 0
            )
            .map((city: { id: number }) => city.id);
        expect(cityCandidates.length).toBeGreaterThan(0);

        const createdGeneral = await gameClientAuthed.join.createGeneral.mutate({
            name: 'IntegrationUser',
            leadership: 55,
            strength: 55,
            intel: 55,
            character: 'Random',
            inheritCity: cityCandidates[0]!,
        });
        expect(createdGeneral.generalId).toBeGreaterThan(0);

        const settingResult = await gameClientAuthed.general.setMySetting.mutate({
            tnmt: 1,
        });
        expect(settingResult.ok).toBe(true);

        const eventsPath = process.env.GAME_API_EVENTS_PATH ?? '/events';
        const runStartMs = Date.now();
        const ssePromise = waitForSseEvent({
            url: `${gameUrl}${eventsPath}`,
            token: accessTokenRef.value ?? '',
            eventName: 'turnCompleted',
            minAtMs: runStartMs,
            timeoutMs: 30_000,
        });

        const runStatus = await runTurn(gameClientPublic);
        expect(runStatus.lastRunAt).toBeTruthy();

        const realtimeEvent = await ssePromise;
        expect(realtimeEvent.type).toBe('turnCompleted');

        const gameDatabaseUrl = resolvePostgresConfigFromEnv({ schema: profile }).url;
        const connector = createGamePostgresConnector({ url: gameDatabaseUrl });
        await connector.connect();
        try {
            const worldState = await connector.prisma.worldState.findFirst({
                select: { updatedAt: true },
            });
            expect(worldState?.updatedAt).toBeTruthy();
            if (worldState?.updatedAt) {
                expect(worldState.updatedAt.getTime()).toBeGreaterThanOrEqual(runStartMs);
            }
        } finally {
            await connector.disconnect();
        }
    }, 120_000);
});
