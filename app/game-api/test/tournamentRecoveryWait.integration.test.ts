import { expect, it } from 'vitest';
import fastify from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { createGamePostgresConnector, createRedisConnector } from '@sammo-ts/infra';
import { DatabaseTurnDaemonCommandQueue, DatabaseTurnDaemonLease } from '@sammo-ts/game-engine';
import { appRouter } from '../src/router.js';
import { DatabaseTurnDaemonTransport } from '../src/daemon/databaseTransport.js';
import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { GameApiContext } from '../src/context.js';
import { loadCurrentGameTime } from '../src/services/gameClock.js';

const databaseUrl = process.env.TOURNAMENT_RECOVERY_DATABASE_URL;
const integration = it.skipIf(!databaseUrl || !process.env.REDIS_URL);

integration(
    'accepts an authenticated HTTP tournament join during recovery wait with durable fee and Redis fences',
    async () => {
        const schema = new URL(databaseUrl!).searchParams.get('schema');
        if (!schema?.endsWith('_tournament_recovery_integration'))
            throw new Error('Dedicated tournament fixture schema required');
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        const redisConnector = createRedisConnector({ url: process.env.REDIS_URL! });
        await connector.connect();
        await redisConnector.connect();
        const db = connector.prisma;
        const redis = redisConnector.client;
        const profile = 'test:recovery-wait';
        const prefix = `sammo:${profile}`;
        const tokenStore = new RedisAccessTokenStore(redis, profile);
        const transport = new DatabaseTurnDaemonTransport(db, 4000);
        const lease = await DatabaseTurnDaemonLease.connect(databaseUrl!, { profile, heartbeat: false });
        const queue = new DatabaseTurnDaemonCommandQueue(db);
        const app = fastify();
        let workerError: unknown;
        let workerBusy = false;
        let timer: ReturnType<typeof setInterval> | undefined;
        try {
            await db.inputEvent.deleteMany();
            await db.general.deleteMany();
            await db.turnDaemonLease.deleteMany();
            await db.worldState.deleteMany();
            const baseTime = new Date('2026-01-01T00:00:00Z');
            const waitAt = new Date(Date.now() + 1_800_000);
            const world = await db.worldState.create({
                data: {
                    scenarioCode: 'recovery-wait',
                    currentYear: 200,
                    currentMonth: 1,
                    tickSeconds: 3600,
                    clockBaseTime: baseTime,
                    clockTick: 0n,
                    lastTurnTick: 0n,
                    clockWallAnchor: waitAt,
                    clockRecoveryStartTick: 0n,
                    clockRecoveryEndTick: 36_000_000n,
                    clockRecoveryStartWallAt: waitAt,
                    clockMode: 'realtime',
                    clockPhase: 'RUNNING',
                    clockRevision: 1n,
                    deadlineGeneration: 1n,
                    config: { const: { develCost: 100 } },
                },
            });
            await db.general.create({
                data: { id: 901, userId: 'fixture-user', name: 'fixture', gold: 1000, turnTime: baseTime },
            });
            await lease.acquire();
            await lease.markClockReady();
            await queue.initialize();
            await redis.set(
                `${prefix}:tournament:state`,
                JSON.stringify({
                    stage: 1,
                    phase: 0,
                    type: 0,
                    auto: true,
                    openYear: 200,
                    openMonth: 1,
                    termSeconds: 60,
                    nextAt: baseTime.toISOString(),
                })
            );
            await redis.set(`${prefix}:tournament:participants`, '[]');
            await redis.del([
                `${prefix}:clock:active-revision`,
                `${prefix}:clock:deadline-generation`,
                `${prefix}:clock:phase`,
            ]);
            const auth: NonNullable<GameApiContext['auth']> = {
                version: 1,
                profile,
                sessionId: 'fixture-session',
                issuedAt: new Date().toISOString(),
                expiresAt: '2999-01-01T00:00:00Z',
                user: { id: 'fixture-user', username: 'fixture', displayName: 'fixture', roles: [] },
                sanctions: {},
            };
            await app.register(fastifyTRPCPlugin, {
                prefix: '/trpc',
                trpcOptions: {
                    router: appRouter,
                    createContext: ({
                        req,
                    }: {
                        req: { headers: Record<string, string | string[] | undefined> };
                    }): GameApiContext => ({
                        db,
                        redis,
                        profile: { id: 'test', scenario: 'recovery-wait', name: profile },
                        auth: req.headers.authorization === 'Bearer fixture-auth' ? auth : null,
                        requestId:
                            typeof req.headers['x-test-request'] === 'string'
                                ? req.headers['x-test-request']
                                : undefined,
                        turnDaemon: transport,
                        accessTokenStore: tokenStore,
                        flushStore: new InMemoryFlushStore(),
                        battleSim: {} as GameApiContext['battleSim'],
                        uploadDir: '/tmp',
                        uploadPath: '/uploads',
                        uploadPublicUrl: null,
                        gameTokenSecret: 'fixture-only',
                    }),
                },
            });
            await app.listen({ host: '127.0.0.1', port: 0 });
            const address = app.server.address();
            if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
            const url = `http://127.0.0.1:${address.port}/trpc/tournament.join`;
            const post = (authenticated = true) =>
                fetch(url, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        ...(authenticated ? { authorization: 'Bearer fixture-auth' } : {}),
                        'x-test-request': 'recovery-join',
                    },
                    body: '{}',
                });
            expect((await post(false)).status).toBe(401);
            expect(await loadCurrentGameTime(db)).toMatchObject({
                phase: 'RUNNING',
                running: false,
                runtimeReady: true,
            });
            // Fixture worker: production queue/lease and real PostgreSQL transaction; no auto turns.
            timer = setInterval(() => {
                if (workerBusy) return;
                workerBusy = true;
                void (async () => {
                    for (const command of await queue.drain()) {
                        if (command.type !== 'adjustGeneralResources' || !command.requestId)
                            throw new Error('Unexpected fixture command');
                        await db.$transaction(async (tx) => {
                            await lease.assertActive(tx);
                            const adjustment = command.adjustments[0]!;
                            await tx.general.update({
                                where: { id: adjustment.generalId },
                                data: { gold: { increment: adjustment.goldDelta ?? 0 } },
                            });
                            await tx.inputEvent.update({
                                where: { requestId: command.requestId },
                                data: {
                                    status: 'SUCCEEDED',
                                    result: {
                                        type: 'adjustGeneralResources',
                                        ok: true,
                                        processed: 1,
                                        missing: 0,
                                        totalGoldDelta: adjustment.goldDelta ?? 0,
                                        totalRiceDelta: 0,
                                    },
                                },
                            });
                        });
                    }
                })()
                    .catch((error: unknown) => {
                        workerError = error;
                    })
                    .finally(() => {
                        workerBusy = false;
                    });
            }, 10);
            expect((await post()).status).toBe(200);
            expect((await post()).status).toBe(200);
            expect(workerError).toBeUndefined();
            expect((await db.general.findUniqueOrThrow({ where: { id: 901 } })).gold).toBe(900);
            expect(JSON.parse((await redis.get(`${prefix}:tournament:participants`))!)).toHaveLength(1);
            const events = await db.inputEvent.findMany({ where: { eventType: 'adjustGeneralResources' } });
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({ status: 'SUCCEEDED', acceptedGameTick: 0n, acceptedClockRevision: 1n });
            await redis.set(`${prefix}:clock:active-revision`, '2');
            expect((await post()).status).toBe(412);
            await redis.set(`${prefix}:clock:active-revision`, '1');
            await db.worldState.update({ where: { id: world.id }, data: { clockPhase: 'RECONCILING' } });
            expect((await post()).status).toBe(412);
            await db.worldState.update({ where: { id: world.id }, data: { clockPhase: 'RUNNING' } });
            await lease.release();
            expect((await post()).status).toBe(412);
            expect((await db.general.findUniqueOrThrow({ where: { id: 901 } })).gold).toBe(900);
            expect((await db.worldState.findUniqueOrThrow({ where: { id: world.id } })).clockTick).toBe(0n);
        } finally {
            if (timer) clearInterval(timer);
            while (workerBusy) await new Promise((resolve) => setTimeout(resolve, 10));
            await app.close();
            await lease.close();
            await connector.disconnect();
            await redisConnector.disconnect();
        }
    },
    15000
);
