import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';

import type { AppRouter as GatewayAppRouter } from '@sammo-ts/gateway-api';
import { createGatewayApiServer } from '@sammo-ts/gateway-api';
import type { AppRouter as GameAppRouter } from '@sammo-ts/game-api';
import {
    createGameApiServer,
    buildAuctionTimerKeys,
    seedAuctionTimers,
    DatabaseTurnDaemonTransport,
} from '@sammo-ts/game-api';
import { createTurnDaemonRuntime } from '@sammo-ts/game-engine';
import {
    createGatewayPostgresConnector,
    createGamePostgresConnector,
    resolvePostgresConfigFromEnv,
    createRedisConnector,
    resolveRedisConfigFromEnv,
    GamePrisma,
} from '@sammo-ts/infra';
import { buildNeutralResourceAuctionPlan, ItemLoader, ITEM_KEYS } from '@sammo-ts/logic';

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

const resolveSlotField = (slot: string) => {
    switch (slot) {
        case 'weapon':
            return 'weaponCode';
        case 'book':
            return 'bookCode';
        case 'horse':
            return 'horseCode';
        case 'item':
            return 'itemCode';
        default:
            return null;
    }
};

const findUniqueItemPair = async () => {
    const loader = new ItemLoader();
    const bySlot = new Map<string, string[]>();
    for (const key of ITEM_KEYS) {
        const module = await loader.load(key).catch(() => null);
        if (!module || module.buyable) {
            continue;
        }
        const slot = module.slot;
        if (!slot) {
            continue;
        }
        const list = bySlot.get(slot) ?? [];
        list.push(key);
        bySlot.set(slot, list);
    }
    for (const [slot, keys] of bySlot.entries()) {
        if (keys.length >= 2) {
            return { slot, keyA: keys[0]!, keyB: keys[1]! };
        }
    }
    throw new Error('unique item pair not found');
};

describe('auction integration flow', () => {
    let gatewayServer: Awaited<ReturnType<typeof createGatewayApiServer>> | null = null;
    let gameServer: Awaited<ReturnType<typeof createGameApiServer>> | null = null;
    let turnDaemon: Awaited<ReturnType<typeof createTurnDaemonRuntime>> | null = null;
    let turnDaemonLoop: Promise<void> | null = null;

    let gatewayClient: ReturnType<typeof createGatewayClient> | null = null;
    let gameClient: ReturnType<typeof createGameClient> | null = null;
    let gameUrl = '';

    let gameConnector: Awaited<ReturnType<typeof createGamePostgresConnector>> | null = null;
    let redisConnector: Awaited<ReturnType<typeof createRedisConnector>> | null = null;

    const userSessions: Array<{
        username: string;
        accessToken: string;
        generalId: number;
        userId: string;
    }> = [];

    beforeAll(async () => {
        await loadEnv();
        process.env.SCENARIO = '908';
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

        const gatewayUrl = `http://localhost:${gatewayServer.config.port}`;
        gameUrl = `http://localhost:${gameServer.config.port}`;
        const adminSessionRef: { value?: string } = {};
        const gameAccessRef: { value?: string } = {};
        gatewayClient = createGatewayClient(gatewayUrl, gatewayServer.config.trpcPath, adminSessionRef);
        gameClient = createGameClient(gameUrl, gameServer.config.trpcPath, gameAccessRef);
        if (!gatewayClient || !gameClient) {
            throw new Error('clients not initialized');
        }

        const bootstrap = await gatewayClient.auth.bootstrapLocal.mutate({
            token: process.env.GATEWAY_BOOTSTRAP_TOKEN ?? '',
            username: 'admin',
            password: 'admin-pass-123',
            displayName: '관리자',
        });
        adminSessionRef.value = bootstrap.sessionToken;

        const demoUsers = Array.from({ length: 4 }, (_, idx) => ({
            username: `auction-user-${idx + 1}`,
            password: `auction-pass-${idx + 1}`,
            displayName: `경매유저${idx + 1}`,
        }));

        for (const user of demoUsers) {
            await gatewayClient.admin.users.createLocal.mutate({
                username: user.username,
                password: user.password,
                displayName: user.displayName,
            });
        }

        await gatewayClient.admin.profiles.upsert.mutate({
            profile: 'che',
            scenario: '908',
            apiPort: Number(process.env.GAME_API_PORT ?? 14000),
            status: 'RUNNING',
        });

        await gatewayClient.admin.profiles.installNow.mutate({
            profileName: 'che:908',
            install: {
                scenarioId: 908,
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

        const adminGatewayToken = await gatewayClient.auth.issueGameSession.mutate({
            sessionToken: adminSessionRef.value ?? '',
            profile: 'che:908',
        });
        const adminAccess = await gameClient.auth.exchangeGatewayToken.mutate({
            gatewayToken: adminGatewayToken.gameToken,
        });
        gameAccessRef.value = adminAccess.accessToken;

        for (const user of demoUsers) {
            const login = await gatewayClient.auth.login.mutate({
                username: user.username,
                password: user.password,
            });
            const gatewayToken = await gatewayClient.auth.issueGameSession.mutate({
                sessionToken: login.sessionToken,
                profile: 'che:908',
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
            userSessions.push({
                username: user.username,
                accessToken: access.accessToken,
                generalId: created.generalId,
                userId: '',
            });
        }

        const gameDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'che' }).url;
        const gatewayDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'public' }).url;
        turnDaemon = await createTurnDaemonRuntime({
            profile: 'che',
            profileName: 'che:908',
            databaseUrl: gameDatabaseUrl,
            gatewayDatabaseUrl,
        });
        turnDaemonLoop = turnDaemon.lifecycle.start();

        const waitForStatus = async (timeoutMs = 10_000) => {
            if (!gameClient) {
                throw new Error('game client missing');
            }
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
        await waitForStatus();

        gameConnector = createGamePostgresConnector({ url: gameDatabaseUrl });
        await gameConnector.connect();
        redisConnector = createRedisConnector(resolveRedisConfigFromEnv());
        await redisConnector.connect();

        for (const session of userSessions) {
            const row = await gameConnector.prisma.general.findUnique({
                where: { id: session.generalId },
                select: { userId: true },
            });
            if (!row?.userId) {
                throw new Error('user id not found');
            }
            session.userId = row.userId;
        }
    }, 120_000);

    afterAll(async () => {
        if (turnDaemon) {
            await turnDaemon.lifecycle.stop('integration-test');
            await turnDaemon.close();
            await turnDaemonLoop;
        }
        if (redisConnector) {
            await redisConnector.disconnect();
        }
        if (gameConnector) {
            await gameConnector.disconnect();
        }
        if (gameServer) {
            await gameServer.app.close();
        }
        if (gatewayServer) {
            await gatewayServer.app.close();
        }
    }, 30_000);

    it('handles resource auction flow with bidding, extension, and finalization', async () => {
        if (!gameConnector || !redisConnector || !gameServer) {
            throw new Error('runtime not ready');
        }
        const prisma = gameConnector.prisma;
        const redis = redisConnector.client;

        const [bidder1, bidder2, bidder3, poorBidder] = userSessions;
        if (!bidder1 || !bidder2 || !bidder3 || !poorBidder) {
            throw new Error('not enough bidders');
        }

        await prisma.general.updateMany({
            where: { id: { in: [bidder1.generalId, bidder2.generalId, bidder3.generalId] } },
            data: { gold: 2000, rice: 1500 },
        });
        await prisma.general.update({
            where: { id: poorBidder.generalId },
            data: { gold: 50, rice: 1000 },
        });
        await prisma.worldState.updateMany({
            data: { currentMonth: 4 },
        });

        if (turnDaemon) {
            await turnDaemon.lifecycle.stop('integration-test');
            await turnDaemon.close();
            await turnDaemonLoop;
        }
        const gameDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'che' }).url;
        const gatewayDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'public' }).url;
        turnDaemon = await createTurnDaemonRuntime({
            profile: 'che',
            profileName: 'che:908',
            databaseUrl: gameDatabaseUrl,
            gatewayDatabaseUrl,
        });
        turnDaemonLoop = turnDaemon.lifecycle.start();
        await sleep(500);

        const hostClient = createGameClient(gameUrl, gameServer.config.trpcPath, {
            value: bidder3.accessToken,
        });
        const opened = await hostClient.auction.openBuyRice.mutate({
            amount: 500,
            closeTurnCnt: 1,
            startBidAmount: 250,
            finishBidAmount: 1000,
        });
        const auction = await prisma.auction.findUniqueOrThrow({ where: { id: opened.auctionId } });
        const initialCloseAt = auction.closeAt;

        const keys = buildAuctionTimerKeys(gameServer.config.profileName);
        await seedAuctionTimers(prisma, redis, keys);
        const initialScore = await redis.zScore(keys.timerKey, String(auction.id));
        expect(Number(initialScore)).toBe(initialCloseAt.getTime());

        const bidder1Client = createGameClient(gameUrl, gameServer.config.trpcPath, {
            value: bidder1.accessToken,
        });
        await bidder1Client.auction.bidBuyRice.mutate({ auctionId: auction.id, amount: 300 });

        const bidRows = await prisma.auctionBid.findMany({ where: { auctionId: auction.id } });
        expect(bidRows).toHaveLength(1);

        const poorClient = createGameClient(gameUrl, gameServer.config.trpcPath, {
            value: poorBidder.accessToken,
        });
        await expect(poorClient.auction.bidBuyRice.mutate({ auctionId: auction.id, amount: 500 })).rejects.toThrow(
            '금이 부족합니다.'
        );

        const updatedAuction = await prisma.auction.findUnique({
            where: { id: auction.id },
            select: { closeAt: true },
        });
        expect(updatedAuction).not.toBeNull();
        expect(updatedAuction!.closeAt.getTime()).toBeGreaterThan(initialCloseAt.getTime());

        const updatedScore = await redis.zScore(keys.timerKey, String(auction.id));
        expect(Number(updatedScore)).toBe(updatedAuction?.closeAt.getTime());

        const finalizeAt = new Date(Date.now() - 1000);
        await prisma.auction.update({
            where: { id: auction.id },
            data: { closeAt: finalizeAt, status: 'OPEN' },
        });
        await redis.zAdd(keys.timerKey, [{ score: finalizeAt.getTime(), value: String(auction.id) }]);

        const transport = new DatabaseTurnDaemonTransport(prisma, 30_000);
        await prisma.$executeRaw(
            GamePrisma.sql`
                UPDATE auction
                SET status = 'FINALIZING',
                    finalizing_at = ${new Date()},
                    updated_at = ${new Date()}
                WHERE id = ${auction.id}
            `
        );
        const result = await transport.requestCommand({ type: 'auctionFinalize', auctionId: auction.id }, 30_000);
        expect(result?.ok).toBe(true);

        const finished = await prisma.auction.findUnique({
            where: { id: auction.id },
            select: { status: true },
        });
        expect(finished?.status).toBe('FINISHED');

        const bidderRow = await prisma.general.findUnique({
            where: { id: bidder1.generalId },
            select: { rice: true },
        });
        expect(bidderRow).not.toBeNull();
        expect(bidderRow!.rice).toBe(2000);
    }, 60_000);

    it('handles unique auction constraints and finalization extension', async () => {
        if (!gameConnector || !redisConnector || !gameServer) {
            throw new Error('runtime not ready');
        }
        const prisma = gameConnector.prisma;
        const redis = redisConnector.client;

        const [ownerBidder, validBidder, spareBidder, extraBidder] = userSessions;
        if (!ownerBidder || !validBidder || !spareBidder || !extraBidder) {
            throw new Error('not enough bidders');
        }

        const uniquePair = await findUniqueItemPair();
        const slotField = resolveSlotField(uniquePair.slot);
        if (!slotField) {
            throw new Error('unsupported item slot');
        }
        const slotUpdate = { [slotField]: uniquePair.keyB } as GamePrisma.GeneralUpdateInput;

        await prisma.general.update({
            where: { id: ownerBidder.generalId },
            data: slotUpdate,
        });
        await prisma.general.update({
            where: { id: validBidder.generalId },
            data: { weaponCode: 'None', bookCode: 'None', horseCode: 'None', itemCode: 'None' },
        });

        await prisma.inheritancePoint.upsert({
            where: { userId_key: { userId: ownerBidder.userId, key: 'previous' } },
            update: { value: 1000 },
            create: { userId: ownerBidder.userId, key: 'previous', value: 1000 },
        });
        await prisma.inheritancePoint.upsert({
            where: { userId_key: { userId: validBidder.userId, key: 'previous' } },
            update: { value: 2000 },
            create: { userId: validBidder.userId, key: 'previous', value: 2000 },
        });
        await prisma.inheritancePoint.upsert({
            where: { userId_key: { userId: spareBidder.userId, key: 'previous' } },
            update: { value: 2000 },
            create: { userId: spareBidder.userId, key: 'previous', value: 2000 },
        });
        await prisma.inheritancePoint.upsert({
            where: { userId_key: { userId: extraBidder.userId, key: 'previous' } },
            update: { value: 2000 },
            create: { userId: extraBidder.userId, key: 'previous', value: 2000 },
        });

        const now = new Date();
        const initialCloseAt = new Date(now.getTime() + 10_000);
        const auction = await prisma.auction.create({
            data: {
                type: 'UNIQUE_ITEM',
                targetCode: uniquePair.keyA,
                hostGeneralId: 0,
                hostName: '시스템',
                detail: {
                    startBidAmount: 200,
                    isReverse: false,
                    availableLatestBidCloseDate: new Date(now.getTime() + 10 * 60_000).toISOString(),
                },
                status: 'OPEN',
                closeAt: initialCloseAt,
            },
        });

        const keys = buildAuctionTimerKeys(gameServer.config.profileName);
        await seedAuctionTimers(prisma, redis, keys);
        const initialScore = await redis.zScore(keys.timerKey, String(auction.id));
        expect(Number(initialScore)).toBe(initialCloseAt.getTime());

        const ownerClient = createGameClient(gameUrl, gameServer.config.trpcPath, {
            value: ownerBidder.accessToken,
        });
        await expect(ownerClient.auction.bidUnique.mutate({ auctionId: auction.id, amount: 300 })).rejects.toThrow(
            '이미 다른 유니크를 가지고 있습니다.'
        );

        const validClient = createGameClient(gameUrl, gameServer.config.trpcPath, {
            value: validBidder.accessToken,
        });
        await validClient.auction.bidUnique.mutate({ auctionId: auction.id, amount: 300 });

        const updatedAuction = await prisma.auction.findUnique({
            where: { id: auction.id },
            select: { closeAt: true },
        });
        expect(updatedAuction).not.toBeNull();
        expect(updatedAuction!.closeAt.getTime()).toBeGreaterThan(initialCloseAt.getTime());

        await prisma.general.update({
            where: { id: validBidder.generalId },
            data: slotUpdate,
        });

        if (turnDaemon) {
            await turnDaemon.lifecycle.stop('integration-test');
            await turnDaemon.close();
            await turnDaemonLoop;
        }
        const gameDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'che' }).url;
        const gatewayDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'public' }).url;
        turnDaemon = await createTurnDaemonRuntime({
            profile: 'che',
            profileName: 'che:908',
            databaseUrl: gameDatabaseUrl,
            gatewayDatabaseUrl,
        });
        turnDaemonLoop = turnDaemon.lifecycle.start();
        await sleep(500);

        const finalizeAt = new Date(Date.now() - 1000);
        await prisma.auction.update({
            where: { id: auction.id },
            data: { closeAt: finalizeAt, status: 'OPEN' },
        });
        await redis.zAdd(keys.timerKey, [{ score: finalizeAt.getTime(), value: String(auction.id) }]);

        const transport = new DatabaseTurnDaemonTransport(prisma, 30_000);
        await prisma.$executeRaw(
            GamePrisma.sql`
                UPDATE auction
                SET status = 'FINALIZING',
                    finalizing_at = ${new Date()},
                    updated_at = ${new Date()}
                WHERE id = ${auction.id}
            `
        );
        const result = await transport.requestCommand({ type: 'auctionFinalize', auctionId: auction.id }, 30_000);
        expect(result?.ok).toBe(false);

        const reopened = await prisma.auction.findUnique({
            where: { id: auction.id },
            select: { status: true, closeAt: true },
        });
        expect(reopened?.status).toBe('OPEN');
        expect(reopened?.closeAt.getTime()).toBeGreaterThan(finalizeAt.getTime());
    }, 60_000);

    it('unique auction: two bidders extend until limit, then winner gets item', async () => {
        if (!gameConnector || !redisConnector || !gameServer) {
            throw new Error('runtime not ready');
        }
        const prisma = gameConnector.prisma;
        const redis = redisConnector.client;

        const [bidderA, bidderB] = userSessions;
        if (!bidderA || !bidderB) {
            throw new Error('not enough bidders');
        }

        const uniquePair = await findUniqueItemPair();
        const slotField = resolveSlotField(uniquePair.slot);
        if (!slotField) {
            throw new Error('unsupported item slot');
        }

        await prisma.general.update({
            where: { id: bidderA.generalId },
            data: { weaponCode: 'None', bookCode: 'None', horseCode: 'None', itemCode: 'None' },
        });
        await prisma.general.update({
            where: { id: bidderB.generalId },
            data: { weaponCode: 'None', bookCode: 'None', horseCode: 'None', itemCode: 'None' },
        });
        await prisma.general.updateMany({
            where: { [slotField]: uniquePair.keyA } as GamePrisma.GeneralWhereInput,
            data: { [slotField]: 'None' } as GamePrisma.GeneralUpdateManyMutationInput,
        });

        await prisma.inheritancePoint.upsert({
            where: { userId_key: { userId: bidderA.userId, key: 'previous' } },
            update: { value: 100_000 },
            create: { userId: bidderA.userId, key: 'previous', value: 100_000 },
        });
        await prisma.inheritancePoint.upsert({
            where: { userId_key: { userId: bidderB.userId, key: 'previous' } },
            update: { value: 100_000 },
            create: { userId: bidderB.userId, key: 'previous', value: 100_000 },
        });

        if (turnDaemon) {
            await turnDaemon.lifecycle.stop('integration-test');
            await turnDaemon.close();
            await turnDaemonLoop;
        }
        const gameDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'che' }).url;
        const gatewayDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'public' }).url;
        turnDaemon = await createTurnDaemonRuntime({
            profile: 'che',
            profileName: 'che:908',
            databaseUrl: gameDatabaseUrl,
            gatewayDatabaseUrl,
        });
        turnDaemonLoop = turnDaemon.lifecycle.start();
        await sleep(500);

        const now = new Date();
        await prisma.$executeRaw(
            GamePrisma.sql`
                UPDATE auction
                SET status = 'CANCELED',
                    finished_at = ${now},
                    updated_at = ${now}
                WHERE status = 'OPEN'
                  AND type = 'UNIQUE_ITEM'
            `
        );

        const keys = buildAuctionTimerKeys(gameServer.config.profileName);
        await redis.del(keys.timerKey);

        const bidderAClient = createGameClient(gameUrl, gameServer.config.trpcPath, { value: bidderA.accessToken });
        const bidderBClient = createGameClient(gameUrl, gameServer.config.trpcPath, { value: bidderB.accessToken });
        const opened = await bidderAClient.auction.openUnique.mutate({
            itemKey: uniquePair.keyA,
            amount: 5000,
        });
        const limitCloseAt = new Date(now.getTime() + 60_000);
        await prisma.$executeRaw(
            GamePrisma.sql`
                UPDATE auction
                SET close_at = ${new Date(now.getTime() + 2000)},
                    detail = jsonb_set(
                        jsonb_set(
                            detail,
                            '{availableLatestBidCloseDate}',
                            to_jsonb(${limitCloseAt.toISOString()}::text)
                        ),
                        '{remainCloseDateExtensionCnt}',
                        '0'::jsonb
                    ),
                    updated_at = ${now}
                WHERE id = ${opened.auctionId}
            `
        );
        const auction = await prisma.auction.findUniqueOrThrow({ where: { id: opened.auctionId } });

        await seedAuctionTimers(prisma, redis, keys);

        await bidderBClient.auction.bidUnique.mutate({ auctionId: auction.id, amount: 5100, tryExtendCloseDate: true });
        await bidderAClient.auction.bidUnique.mutate({ auctionId: auction.id, amount: 5200, tryExtendCloseDate: true });
        await bidderBClient.auction.bidUnique.mutate({ auctionId: auction.id, amount: 5300, tryExtendCloseDate: true });
        await bidderAClient.auction.bidUnique.mutate({ auctionId: auction.id, amount: 5400, tryExtendCloseDate: true });
        await bidderBClient.auction.bidUnique.mutate({ auctionId: auction.id, amount: 5500, tryExtendCloseDate: true });

        const afterBids = await prisma.auction.findUnique({
            where: { id: auction.id },
            select: { closeAt: true },
        });
        expect(afterBids).not.toBeNull();
        expect(afterBids!.closeAt.getTime()).toBe(limitCloseAt.getTime());

        const finalizeAt = new Date(Date.now() - 1000);
        await prisma.auction.update({
            where: { id: auction.id },
            data: { closeAt: finalizeAt, status: 'OPEN' },
        });
        await redis.zAdd(keys.timerKey, [{ score: finalizeAt.getTime(), value: String(auction.id) }]);

        const transport = new DatabaseTurnDaemonTransport(prisma, 30_000);
        await prisma.$executeRaw(
            GamePrisma.sql`
                UPDATE auction
                SET status = 'FINALIZING',
                    finalizing_at = ${new Date()},
                    updated_at = ${new Date()}
                WHERE id = ${auction.id}
            `
        );
        const result = await transport.requestCommand({ type: 'auctionFinalize', auctionId: auction.id }, 30_000);
        expect(result?.ok).toBe(true);

        const winner = await prisma.general.findUnique({
            where: { id: bidderB.generalId },
            select: { weaponCode: true, bookCode: true, horseCode: true, itemCode: true },
        });
        expect(winner).not.toBeNull();
        expect(Object.values(winner!)).toContain(uniquePair.keyA);
    }, 60_000);

    it('opens the same neutral merchant auctions on the legacy monthly boundary', async () => {
        if (!gameConnector) {
            throw new Error('runtime not ready');
        }
        const prisma = gameConnector.prisma;
        if (turnDaemon) {
            await turnDaemon.lifecycle.stop('integration-test');
            await turnDaemon.close();
            await turnDaemonLoop;
        }

        await prisma.auction.deleteMany({
            where: {
                hostGeneralId: 0,
                type: { in: ['BUY_RICE', 'SELL_RICE'] },
            },
        });
        const futureTurn = new Date(Date.now() + 60 * 60_000);
        await prisma.general.updateMany({
            where: { npcState: { lt: 2 } },
            data: {
                gold: 5_432,
                rice: 7_654,
                turnTime: futureTurn,
            },
        });
        const nationCount = await prisma.nation.count();
        let hiddenSeed = '';
        let expected = [] as ReturnType<typeof buildNeutralResourceAuctionPlan>;
        for (let index = 0; index < 1_000; index += 1) {
            hiddenSeed = `integration-neutral-${index}`;
            expected = buildNeutralResourceAuctionPlan({
                hiddenSeed,
                seedYear: 180,
                seedMonth: 1,
                nationCount,
                consumeTournamentRoll: false,
                averageGold: 5_432,
                averageRice: 7_654,
                buyRiceAuctionCount: 0,
                sellRiceAuctionCount: 0,
            });
            if (expected.length > 0) {
                break;
            }
        }
        expect(expected.length).toBeGreaterThan(0);

        const worldState = await prisma.worldState.findFirstOrThrow();
        const worldMeta =
            worldState.meta && typeof worldState.meta === 'object' && !Array.isArray(worldState.meta)
                ? worldState.meta
                : {};
        await prisma.worldState.update({
            where: { id: worldState.id },
            data: {
                currentYear: 180,
                currentMonth: 1,
                tickSeconds: 60,
                meta: {
                    ...worldMeta,
                    hiddenSeed,
                    lastTurnTime: new Date(Date.now() - 61_000).toISOString(),
                    neutralAuctionRegistrationKey: null,
                },
            },
        });

        const gameDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'che' }).url;
        const gatewayDatabaseUrl = resolvePostgresConfigFromEnv({ schema: 'public' }).url;
        turnDaemon = await createTurnDaemonRuntime({
            profile: 'che',
            profileName: 'che:908',
            databaseUrl: gameDatabaseUrl,
            gatewayDatabaseUrl,
        });
        turnDaemonLoop = turnDaemon.lifecycle.start();

        const deadline = Date.now() + 10_000;
        let rows = await prisma.auction.findMany({
            where: {
                hostGeneralId: 0,
                type: { in: ['BUY_RICE', 'SELL_RICE'] },
            },
            orderBy: { id: 'asc' },
        });
        while (rows.length < expected.length && Date.now() < deadline) {
            await sleep(100);
            rows = await prisma.auction.findMany({
                where: {
                    hostGeneralId: 0,
                    type: { in: ['BUY_RICE', 'SELL_RICE'] },
                },
                orderBy: { id: 'asc' },
            });
        }

        expect(rows).toHaveLength(expected.length);
        for (const [index, plan] of expected.entries()) {
            const row = rows[index]!;
            const detail = row.detail as Record<string, unknown>;
            expect(row).toMatchObject({
                type: plan.auctionType,
                targetCode: String(plan.amount),
                hostGeneralId: 0,
                hostName: '상인',
                status: 'OPEN',
            });
            expect(detail).toMatchObject({
                amount: plan.amount,
                startBidAmount: plan.startBidAmount,
                finishBidAmount: plan.finishBidAmount,
                closeTurnCnt: plan.closeTurnCnt,
                seedYear: 180,
                seedMonth: 1,
                neutralRegistrationKey: '180-02',
            });
            expect(row.closeAt.getTime() - row.createdAt.getTime()).toBeGreaterThanOrEqual(
                plan.closeTurnCnt * 60_000 - 2_000
            );
            expect(row.closeAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(
                plan.closeTurnCnt * 60_000 + 2_000
            );
        }
        const persistedState = await prisma.worldState.findUniqueOrThrow({
            where: { id: worldState.id },
        });
        expect(persistedState).toMatchObject({
            currentYear: 180,
            currentMonth: 2,
            meta: expect.objectContaining({ neutralAuctionRegistrationKey: '180-02' }),
        });
    }, 60_000);
});
