import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import { sealGatewayPassword } from '../src/passwordEnvelope.js';

import type { AppRouter as GatewayAppRouter } from '@sammo-ts/gateway-api';
import { clearTournamentRuntimeKeys, createGatewayApiServer } from '@sammo-ts/gateway-api';
import type { AppRouter as GameAppRouter } from '@sammo-ts/game-api';
import {
    buildTournamentKeys,
    createGameApiServer,
    DatabaseTurnDaemonTransport,
    processTournamentTick,
    TournamentStore,
} from '@sammo-ts/game-api';
import { createTurnDaemonRuntime, seedScenarioToDatabase } from '@sammo-ts/game-engine';
import {
    createGamePostgresConnector,
    createGatewayPostgresConnector,
    createRedisConnector,
    resolvePostgresConfigFromEnv,
    resolveRedisConfigFromEnv,
    type GamePrisma,
} from '@sammo-ts/infra';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const parseEnvFile = (rawText: string): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const line of rawText.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const separator = trimmed.indexOf('=');
        if (separator < 0) {
            continue;
        }
        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    return env;
};

const loadEnv = async (): Promise<void> => {
    const values = parseEnvFile(await fs.readFile(path.join(workspaceRoot, '.env.ci'), 'utf8'));
    for (const [key, value] of Object.entries(values)) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
    process.env.INTEGRATION_JOIN_ALLOW_CITY ??= 'true';
    process.env.INTEGRATION_WORLD_SEED ??= 'tournament-lifecycle-seed';
};

const execCommand = (command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> =>
    new Promise((resolve, reject) => {
        execFile(command, args, { env, cwd: workspaceRoot }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`${command} ${args.join(' ')} failed:\n${stdout}\n${stderr}`));
                return;
            }
            resolve();
        });
    });

const ensureSchema = async (schema: string): Promise<void> => {
    const connector = createGatewayPostgresConnector({
        url: resolvePostgresConfigFromEnv({ schema: 'public' }).url,
    });
    await connector.connect();
    try {
        await connector.prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    } finally {
        await connector.disconnect();
    }
};

const truncateSchema = async (schema: string): Promise<void> => {
    const connector = createGatewayPostgresConnector({
        url: resolvePostgresConfigFromEnv({ schema: 'public' }).url,
    });
    await connector.connect();
    try {
        const rows = (await connector.prisma.$queryRawUnsafe(
            `SELECT tablename FROM pg_tables
             WHERE schemaname = '${schema}' AND tablename <> '_prisma_migrations'`
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

const resetServices = async (): Promise<void> => {
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

    const redis = createRedisConnector(resolveRedisConfigFromEnv());
    await redis.connect();
    try {
        await redis.client.flushDb();
    } finally {
        await redis.disconnect();
    }
};

const createGatewayClient = (baseUrl: string, pathName: string, token: { value?: string }) =>
    createTRPCProxyClient<GatewayAppRouter>({
        links: [
            httpBatchLink({
                url: `${baseUrl}${pathName}`,
                headers: () => (token.value ? { 'x-session-token': token.value } : {}),
            }),
        ],
    });

const createGameClient = (baseUrl: string, pathName: string, token: { value?: string }) =>
    createTRPCProxyClient<GameAppRouter>({
        links: [
            httpBatchLink({
                url: `${baseUrl}${pathName}`,
                headers: () => (token.value ? { authorization: `Bearer ${token.value}` } : {}),
            }),
        ],
    });

describe('actual tournament lifecycle', () => {
    let gatewayServer: Awaited<ReturnType<typeof createGatewayApiServer>> | null = null;
    let gameServer: Awaited<ReturnType<typeof createGameApiServer>> | null = null;
    let turnDaemon: Awaited<ReturnType<typeof createTurnDaemonRuntime>> | null = null;
    let turnDaemonLoop: Promise<void> | null = null;
    let gameConnector: Awaited<ReturnType<typeof createGamePostgresConnector>> | null = null;
    let redisConnector: Awaited<ReturnType<typeof createRedisConnector>> | null = null;
    let store: TournamentStore | null = null;
    let transport: DatabaseTurnDaemonTransport | null = null;

    const clients = new Map<string, ReturnType<typeof createGameClient>>();
    const generalIds = new Map<string, number>();

    beforeAll(async () => {
        await loadEnv();
        process.env.SCENARIO = '908';
        process.chdir(workspaceRoot);
        await resetServices();

        gatewayServer = await createGatewayApiServer();
        await gatewayServer.app.listen({ host: gatewayServer.config.host, port: gatewayServer.config.port });
        process.env.GATEWAY_INTERNAL_API_URL = `http://127.0.0.1:${gatewayServer.config.port}`;
        gameServer = await createGameApiServer();
        await gameServer.app.listen({ host: gameServer.config.host, port: gameServer.config.port });

        const gatewayUrl = `http://localhost:${gatewayServer.config.port}`;
        const gameUrl = `http://localhost:${gameServer.config.port}`;
        const adminSession = { value: undefined as string | undefined };
        const gatewayClient = createGatewayClient(gatewayUrl, gatewayServer.config.trpcPath, adminSession);

        const bootstrap = await gatewayClient.auth.bootstrapLocal.mutate({
            token: process.env.GATEWAY_BOOTSTRAP_TOKEN ?? '',
            username: 'admin',
            password: 'admin-pass-123',
            displayName: '관리자',
        });
        adminSession.value = bootstrap.sessionToken;

        const users = [
            ['participant', '대회참가자'],
            ['bettor-a', '베팅유저A'],
            ['bettor-b', '베팅유저B'],
            ['no-general', '무장수유저'],
        ] as const;
        for (const [username, displayName] of users) {
            await gatewayClient.admin.users.createLocal.mutate({
                username,
                password: `${username}-pass`,
                displayName,
            });
        }

        await gatewayClient.admin.profiles.upsert.mutate({
            profile: 'che',
            scenario: '908',
            apiPort: Number(process.env.GAME_API_PORT ?? 14000),
            status: 'RUNNING',
        });
        await gatewayClient.admin.profiles.updateMeta.mutate({
            profileName: 'che:908',
            reason: 'integration test setup',
            patch: {
                localAccountGeneralCreationGraceDays: 7,
            },
        });
        const staleTournamentRedis = createRedisConnector(resolveRedisConfigFromEnv());
        await staleTournamentRedis.connect();
        const staleTournamentKeys = buildTournamentKeys('che:908');
        try {
            await staleTournamentRedis.client.mSet({
                [staleTournamentKeys.stateKey]: JSON.stringify({ stage: 6, auto: true }),
                [staleTournamentKeys.participantsKey]: '[{"id":99999}]',
                [staleTournamentKeys.matchesKey]: '[{"id":99999}]',
                [staleTournamentKeys.bettingKey]: '[{"generalId":99999}]',
            });
        } finally {
            await staleTournamentRedis.disconnect();
        }
        await seedScenarioToDatabase({
            scenarioId: 908,
            databaseUrl: resolvePostgresConfigFromEnv({ schema: 'che' }).url,
            installOptions: {
                turnTermMinutes: 1,
                sync: false,
                fiction: 0,
                extend: true,
                blockGeneralCreate: 0,
                npcMode: 0,
                showImgLevel: 0,
                tournamentTrig: true,
                joinMode: 'full',
                autorunUser: null,
            },
        });

        const resetTournamentRedis = createRedisConnector(resolveRedisConfigFromEnv());
        await resetTournamentRedis.connect();
        try {
            await clearTournamentRuntimeKeys(resetTournamentRedis.client, 'che:908');
            expect(
                await resetTournamentRedis.client.mGet([
                    staleTournamentKeys.stateKey,
                    staleTournamentKeys.participantsKey,
                    staleTournamentKeys.matchesKey,
                    staleTournamentKeys.bettingKey,
                ])
            ).toEqual([null, null, null, null]);
        } finally {
            await resetTournamentRedis.disconnect();
        }

        const gameDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'che' }).url;
        const gatewayDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'public' }).url;
        gameConnector = createGamePostgresConnector({ url: gameDatabaseUrl });
        await gameConnector.connect();
        redisConnector = createRedisConnector(resolveRedisConfigFromEnv());
        await redisConnector.connect();
        store = new TournamentStore(redisConnector.client, buildTournamentKeys('che:908'));
        transport = new DatabaseTurnDaemonTransport(gameConnector.prisma, 30_000);
        turnDaemon = await createTurnDaemonRuntime({
            profile: 'che',
            profileName: 'che:908',
            databaseUrl: gameDatabaseUrl,
            gatewayDatabaseUrl,
            redisUrl: resolveRedisConfigFromEnv().url,
        });
        turnDaemonLoop = turnDaemon.lifecycle.start();
        const status = await transport.requestStatus(10_000);
        expect(status).not.toBeNull();

        for (const [username, displayName] of users) {
            const login = await gatewayClient.auth.login.mutate({
                username,
                credential: sealGatewayPassword(`${username}-pass`, await gatewayClient.auth.passwordKey.query()),
            });
            if (login.status !== 'login') {
                throw new Error('Local integration fixture unexpectedly requires Kakao OTP.');
            }
            const gatewayToken = await gatewayClient.auth.issueGameSession.mutate({
                sessionToken: login.sessionToken,
                profile: 'che:908',
            });
            const accessRef = { value: undefined as string | undefined };
            const client = createGameClient(gameUrl, gameServer.config.trpcPath, accessRef);
            const access = await client.auth.exchangeGatewayToken.mutate({ gatewayToken: gatewayToken.gameToken });
            accessRef.value = access.accessToken;
            clients.set(username, client);

            if (username !== 'no-general') {
                const created = await client.join.createGeneral.mutate({
                    name: displayName,
                    leadership: 55,
                    strength: 55,
                    intel: 55,
                    character: 'Random',
                    pic: true,
                });
                generalIds.set(username, created.generalId);
            }
        }

        await gameConnector.prisma.general.updateMany({
            where: { id: { in: [...generalIds.values()] } },
            data: { gold: 10_000 },
        });
        const maxGeneralId = (await gameConnector.prisma.general.aggregate({ _max: { id: true } }))._max.id ?? 0;
        const npcTemplate = await gameConnector.prisma.general.findFirstOrThrow({
            where: { id: { in: [...generalIds.values()] } },
        });
        const {
            id: _templateId,
            userId: _templateUserId,
            name: _templateName,
            createdAt: _templateCreatedAt,
            updatedAt: _templateUpdatedAt,
            ...npcTemplateData
        } = npcTemplate;
        const templateMeta =
            typeof npcTemplate.meta === 'object' && npcTemplate.meta !== null && !Array.isArray(npcTemplate.meta)
                ? npcTemplate.meta
                : {};
        await gameConnector.prisma.general.createMany({
            data: Array.from({ length: 48 }, (_, index): GamePrisma.GeneralCreateManyInput => ({
                ...npcTemplateData,
                id: maxGeneralId + index + 1,
                userId: null,
                name: `대회NPC${index + 1}`,
                npcState: 2,
                leadership: 40 + (index % 31),
                strength: 40 + ((index * 3) % 31),
                intel: 40 + ((index * 7) % 31),
                gold: 10_000,
                lastTurn: npcTemplate.lastTurn as GamePrisma.InputJsonValue,
                meta: { ...templateMeta, explevel: 20 },
                penalty: npcTemplate.penalty as GamePrisma.InputJsonValue,
            })),
        });

        for (let attempt = 0; attempt < 36; attempt += 1) {
            const current = turnDaemon.world.getState().lastTurnTime;
            const next = new Date(current.getTime());
            next.setUTCMonth(next.getUTCMonth() + 1);
            await turnDaemon.world.advanceMonth(next);
            if ((await store.getState())?.stage === 1) {
                break;
            }
        }
        expect(await store.getState()).toMatchObject({ stage: 1, auto: true });
    }, 120_000);

    afterAll(async () => {
        if (turnDaemon) {
            await turnDaemon.lifecycle.stop('tournament-lifecycle-test');
            await turnDaemon.close();
            await turnDaemonLoop;
        }
        await redisConnector?.disconnect();
        await gameConnector?.disconnect();
        await gameServer?.app.close();
        await gatewayServer?.app.close();
    }, 30_000);

    it('runs auto-open, enrollment, betting, finals, rewards, and payout through the real daemon', async () => {
        if (!store || !transport || !gameConnector) {
            throw new Error('integration runtime is not ready');
        }
        const participant = clients.get('participant')!;
        const bettorA = clients.get('bettor-a')!;
        const bettorB = clients.get('bettor-b')!;
        const noGeneral = clients.get('no-general')!;

        await expect(noGeneral.tournament.getState.query()).rejects.toThrow();
        await expect(participant.tournament.join.mutate()).resolves.toMatchObject({ ok: true });
        await expect(participant.tournament.join.mutate()).resolves.toMatchObject({ ok: true });

        for (let steps = 0; steps < 2000; steps += 1) {
            const state = await store.getState();
            if (!state) {
                throw new Error('tournament state disappeared');
            }
            if (state.stage === 6) {
                break;
            }
            await store.setState({
                ...state,
                nextAt: new Date(Date.now() - 1_000).toISOString(),
            });
            await processTournamentTick({
                store,
                prisma: gameConnector.prisma,
                daemonTransport: transport,
            });
        }

        const bettingState = await store.getState();
        expect(bettingState).toMatchObject({ stage: 6, auto: true });
        const matches = await store.getMatches();
        const candidates = Array.from(
            new Set(
                matches.filter((match) => match.stage === 7).flatMap((match) => [match.attackerId, match.defenderId])
            )
        );
        expect(candidates).toHaveLength(16);

        const idleDeadline = Date.now() + 60_000;
        while (Date.now() < idleDeadline) {
            const pending = await gameConnector.prisma.inputEvent.count({
                where: { status: { in: ['PENDING', 'PROCESSING'] } },
            });
            if (pending === 0) {
                break;
            }
            await sleep(100);
        }
        expect(
            await gameConnector.prisma.inputEvent.count({
                where: { status: { in: ['PENDING', 'PROCESSING'] } },
            })
        ).toBe(0);

        for (const targetId of candidates) {
            await bettorA.tournament.placeBet.mutate({ targetId, amount: 10 });
        }
        await bettorB.tournament.placeBet.mutate({ targetId: candidates[0]!, amount: 100 });

        const bets = await store.getBettingEntries();
        const bettorAId = generalIds.get('bettor-a')!;
        const bettorBId = generalIds.get('bettor-b')!;
        expect(bets.filter((entry) => entry.generalId === bettorAId)).toHaveLength(16);
        expect(bets.some((entry) => entry.generalId === bettorBId && entry.targetId === candidates[0])).toBe(true);
        expect(bets.every((entry) => entry.generalId !== generalIds.get('participant'))).toBe(true);

        const bettorBeforeSettlement = await gameConnector.prisma.general.findUniqueOrThrow({
            where: { id: bettorAId },
            select: { gold: true, meta: true },
        });

        await store.setState({
            ...bettingState!,
            bettingCloseAt: new Date(Date.now() - 1_000).toISOString(),
            nextAt: new Date(Date.now() - 1_000).toISOString(),
        });

        for (let steps = 0; steps < 100; steps += 1) {
            const state = await store.getState();
            if (!state) {
                throw new Error('tournament state disappeared');
            }
            if (state.stage === 0 && state.rewardSettled && state.bettingSettled) {
                break;
            }
            if (state.stage > 0) {
                await store.setState({
                    ...state,
                    bettingCloseAt:
                        state.stage === 6 ? new Date(Date.now() - 1_000).toISOString() : state.bettingCloseAt,
                    nextAt: new Date(Date.now() - 1_000).toISOString(),
                });
            }
            await processTournamentTick({
                store,
                prisma: gameConnector.prisma,
                daemonTransport: transport,
            });
        }

        const finalState = await store.getState();
        expect(finalState).toMatchObject({
            stage: 0,
            auto: false,
            rewardSettled: true,
            bettingSettled: true,
        });
        expect(finalState?.winnerId).toBeTypeOf('number');

        const currentDevelCost = Number(turnDaemon!.world.getState().meta.develcost);
        expect(currentDevelCost).toBeGreaterThan(0);

        const bettorAfterSettlement = await gameConnector.prisma.general.findUniqueOrThrow({
            where: { id: bettorAId },
            select: { gold: true, meta: true },
        });
        expect(bettorAfterSettlement.gold).toBeGreaterThan(bettorBeforeSettlement.gold);
        expect(bettorAfterSettlement.meta).toMatchObject({
            betgold: 160,
            betwin: 1,
        });
        expect(Number((bettorAfterSettlement.meta as Record<string, unknown>).betwingold)).toBeGreaterThan(0);

        const settlementEvents = await gameConnector.prisma.inputEvent.findMany({
            where: { eventType: { in: ['tournamentReward', 'tournamentBettingPayout'] } },
            select: { eventType: true, status: true, result: true },
        });
        expect(settlementEvents).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ eventType: 'tournamentReward', status: 'SUCCEEDED' }),
                expect.objectContaining({ eventType: 'tournamentBettingPayout', status: 'SUCCEEDED' }),
            ])
        );
        expect(settlementEvents.every((event) => (event.result as { ok?: boolean } | null)?.ok === true)).toBe(true);
        const rewardEvent = settlementEvents.find((event) => event.eventType === 'tournamentReward');
        // Ref setGift(): 16*1 + 8*2 + 4*3 + both finalists*6 + winner*8 = 64 develcost.
        expect((rewardEvent?.result as { totalGold?: number } | null)?.totalGold).toBe(currentDevelCost * 64);
    }, 120_000);
});
