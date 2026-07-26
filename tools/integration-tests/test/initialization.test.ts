import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import { sealGatewayPassword } from '../src/passwordEnvelope.js';

import type { AppRouter as GatewayAppRouter } from '@sammo-ts/gateway-api';
import type { AppRouter as GameAppRouter } from '@sammo-ts/game-api';
import { createGatewayApiServer } from '@sammo-ts/gateway-api';
import { createGameApiServer } from '@sammo-ts/game-api';
import { createTurnDaemonRuntime } from '@sammo-ts/game-engine';
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

const resetDatabase = async () => {
    await ensureSchema('public');
    await ensureSchema('che');
    await execCommand('pnpm', ['--filter', '@sammo-ts/infra', 'prisma:db:push:gateway', '--accept-data-loss'], {
        ...process.env,
        POSTGRES_SCHEMA: 'public',
    });
    await execCommand('pnpm', ['--filter', '@sammo-ts/infra', 'prisma:db:push:game', '--accept-data-loss'], {
        ...process.env,
        POSTGRES_SCHEMA: 'che',
    });
    await truncateSchema('public');
    await truncateSchema('che');
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

describe('integration initialization flow', () => {
    let gatewayServer: Awaited<ReturnType<typeof createGatewayApiServer>> | null = null;
    let gameServer: Awaited<ReturnType<typeof createGameApiServer>> | null = null;
    let turnDaemon: Awaited<ReturnType<typeof createTurnDaemonRuntime>> | null = null;
    let turnDaemonLoop: Promise<void> | null = null;

    beforeAll(async () => {
        await loadEnv();
        process.chdir(workspaceRoot);
        await resetDatabase();
        await resetRedis();

        gatewayServer = await createGatewayApiServer();
        await gatewayServer.app.listen({
            host: gatewayServer.config.host,
            port: gatewayServer.config.port,
        });

        gameServer = await createGameApiServer();
        await gameServer.app.listen({
            host: gameServer.config.host,
            port: gameServer.config.port,
        });
    });

    afterAll(async () => {
        if (turnDaemon) {
            await turnDaemon.lifecycle.stop('integration-test');
            await turnDaemon.close();
            await turnDaemonLoop;
        }
        if (gameServer) {
            await gameServer.app.close();
        }
        if (gatewayServer) {
            await gatewayServer.app.close();
        }
    }, 30_000);

    it('seeds scenario, creates users, and validates founding flow', async () => {
        if (!gatewayServer || !gameServer) {
            throw new Error('servers not initialized');
        }

        const gatewayUrl = `http://localhost:${gatewayServer.config.port}`;
        const gameUrl = `http://localhost:${gameServer.config.port}`;
        const adminSessionRef: { value?: string } = {};
        const gameAccessRef: { value?: string } = {};
        const gatewayClient = createGatewayClient(gatewayUrl, gatewayServer.config.trpcPath, adminSessionRef);
        const gameClient = createGameClient(gameUrl, gameServer.config.trpcPath, gameAccessRef);

        const bootstrap = await gatewayClient.auth.bootstrapLocal.mutate({
            token: process.env.GATEWAY_BOOTSTRAP_TOKEN ?? '',
            username: 'admin',
            password: 'admin-pass-123',
            displayName: '관리자',
        });
        adminSessionRef.value = bootstrap.sessionToken;
        expect(bootstrap.user.username).toBe('admin');

        const demoUsers = Array.from({ length: 10 }, (_, idx) => ({
            username: `demo${idx + 1}`,
            password: `demo-pass-${idx + 1}`,
            displayName: `데모${idx + 1}`,
        }));

        for (const user of demoUsers) {
            await gatewayClient.admin.users.createLocal.mutate({
                username: user.username,
                password: user.password,
                displayName: user.displayName,
            });
            const lookup = await gatewayClient.admin.users.lookup.query({ username: user.username });
            expect(lookup?.username).toBe(user.username);
            const login = await gatewayClient.auth.login.mutate({
                username: user.username,
                credential: sealGatewayPassword(user.password, await gatewayClient.auth.passwordKey.query()),
            });
            expect(login.sessionToken).toBeTruthy();
        }

        await gatewayClient.admin.profiles.upsert.mutate({
            profile: 'che',
            scenario: '2',
            apiPort: Number(process.env.GAME_API_PORT ?? 14000),
            status: 'RUNNING',
        });

        await gatewayClient.admin.profiles.installNow.mutate({
            profileName: 'che:2',
            install: {
                scenarioId: 2,
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

        const publicMap = await gameClient.public.getCachedMap.query();
        expect(publicMap.result).toBe(true);
        const nations = await gameClient.public.getNationList.query();
        expect(Array.isArray(nations)).toBe(true);

        const adminGatewayToken = await gatewayClient.auth.issueGameSession.mutate({
            sessionToken: adminSessionRef.value ?? '',
            profile: 'che:2',
        });
        const adminAccess = await gameClient.auth.exchangeGatewayToken.mutate({
            gatewayToken: adminGatewayToken.gameToken,
        });
        gameAccessRef.value = adminAccess.accessToken;
        const adminGeneral = await gameClient.general.me.query();
        expect(adminGeneral?.general).toBeTruthy();

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

        expect(cityCandidates.length).toBeGreaterThanOrEqual(10);

        const userSessions: Array<{
            username: string;
            sessionToken: string;
            accessToken: string;
            generalId: number;
            cityId: number;
        }> = [];

        for (const [idx, user] of demoUsers.entries()) {
            const login = await gatewayClient.auth.login.mutate({
                username: user.username,
                credential: sealGatewayPassword(user.password, await gatewayClient.auth.passwordKey.query()),
            });
            const gatewayToken = await gatewayClient.auth.issueGameSession.mutate({
                sessionToken: login.sessionToken,
                profile: 'che:2',
            });
            const access = await gameClient.auth.exchangeGatewayToken.mutate({
                gatewayToken: gatewayToken.gameToken,
            });
            const accessRef = { value: access.accessToken };
            const userGameClient = createGameClient(gameUrl, gameServer.config.trpcPath, accessRef);
            const created = await userGameClient.join.createGeneral.mutate({
                name: `${user.displayName}`,
                leadership: 55,
                strength: 55,
                intel: 55,
                character: 'Random',
            });
            const generalInfo = await userGameClient.general.me.query();
            if (!generalInfo?.general) {
                throw new Error('general was not created');
            }
            userSessions.push({
                username: user.username,
                sessionToken: login.sessionToken,
                accessToken: access.accessToken,
                generalId: created.generalId,
                cityId: generalInfo.general.cityId,
            });
        }

        const lords = userSessions.slice(0, 3).sort((a, b) => a.generalId - b.generalId);
        const nationIds = lords.map((_, idx) => idx + 1);
        const nationByGeneralId = new Map(lords.map((lord, idx) => [lord.generalId, nationIds[idx]]));
        const joinNationIds = [nationIds[0]!, nationIds[1]!];

        for (const [idx, user] of userSessions.entries()) {
            const accessRef = { value: user.accessToken };
            const userGameClient = createGameClient(gameUrl, gameServer.config.trpcPath, accessRef);
            if (idx < 3) {
                await userGameClient.turns.reserved.setGeneral.mutate({
                    generalId: user.generalId,
                    turnIndex: 0,
                    action: 'che_거병',
                });
                await userGameClient.turns.reserved.setGeneral.mutate({
                    generalId: user.generalId,
                    turnIndex: 1,
                    action: 'che_건국',
                    args: {
                        nationName: `TestNation${idx + 1}`,
                        nationType: 'che_def',
                        colorType: idx,
                    },
                });
            } else {
                const destNationId = joinNationIds[(idx - 3) % joinNationIds.length]!;
                await userGameClient.turns.reserved.setGeneral.mutate({
                    generalId: user.generalId,
                    turnIndex: 0,
                    action: 'che_임관',
                    args: { destNationId },
                });
                await userGameClient.turns.reserved.setGeneral.mutate({
                    generalId: user.generalId,
                    turnIndex: 1,
                    action: 'che_임관',
                    args: { destNationId },
                });
            }
        }

        const gameDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'che' }).url;
        const gatewayDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'public' }).url;
        turnDaemon = await createTurnDaemonRuntime({
            profile: 'che',
            profileName: 'che:2',
            databaseUrl: gameDatabaseUrl,
            gatewayDatabaseUrl,
        });
        turnDaemonLoop = turnDaemon.lifecycle.start();

        const waitForStatus = async (timeoutMs = 10_000) => {
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

        const runTurn = async () => {
            const status = await waitForStatus();
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
                const nextStatus = await waitForStatus();
                if (!nextStatus.running && nextStatus.lastRunAt && nextStatus.lastRunAt !== prevRunAt) {
                    return nextStatus;
                }
                await sleep(200);
            }
            throw new Error('turn run timeout');
        };

        await runTurn();
        await runTurn();
        await runTurn();

        const connector = createGamePostgresConnector({ url: gameDatabaseUrl });
        await connector.connect();
        try {
            const nationRows = (await connector.prisma.nation.findMany({
                where: { id: { gt: 0 } },
                select: { id: true, level: true, capitalCityId: true },
            })) as Array<{ id: number; level: number; capitalCityId: number | null }>;
            expect(nationRows).toHaveLength(3);

            const generalRows = (await connector.prisma.general.findMany({
                where: { nationId: { gt: 0 } },
                select: { id: true, nationId: true },
            })) as Array<{ id: number; nationId: number }>;
            const generalCountMap = new Map<number, number>();
            for (const row of generalRows) {
                generalCountMap.set(row.nationId, (generalCountMap.get(row.nationId) ?? 0) + 1);
            }
            const cityRows = (await connector.prisma.city.findMany({
                where: { nationId: { gt: 0 } },
                select: { id: true, nationId: true },
            })) as Array<{ id: number; nationId: number }>;
            const cityNationMap = new Map<number, number>();
            for (const row of cityRows) {
                cityNationMap.set(row.id, row.nationId);
            }

            for (const lord of lords) {
                const nationId = nationByGeneralId.get(lord.generalId)!;
                const nation = nationRows.find((row) => row.id === nationId);
                expect(nation).toBeTruthy();
                const count = generalCountMap.get(nationId) ?? 0;
                if (count >= 2) {
                    if (nation!.capitalCityId !== null) {
                        expect(cityNationMap.get(nation!.capitalCityId)).toBe(nationId);
                    }
                } else {
                    expect(nation!.level).toBe(0);
                }
            }
        } finally {
            await connector.disconnect();
        }
    });
});
