import fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { buildGameEventChannel } from '@sammo-ts/common';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import {
    createGamePostgresConnector,
    createRedisConnector,
    resolvePostgresConfigFromEnv,
    resolveRedisConfigFromEnv,
} from '@sammo-ts/infra';

import { resolveGameApiConfigFromEnv } from './config.js';
import { createGameApiContext, type DatabaseClient as _DatabaseClient } from './context.js';
import { DatabaseTurnDaemonTransport } from './daemon/databaseTransport.js';
import { InMemoryFlushStore, RedisGatewayFlushSubscriber, type FlushStore } from './auth/flushStore.js';
import { RedisAccessTokenStore } from './auth/accessTokenStore.js';
import { appRouter } from './router.js';
import { buildBattleSimQueueKeys } from './battleSim/keys.js';
import { RedisBattleSimTransport } from './battleSim/redisTransport.js';
import { RedisRealtimeEventHub } from './realtime/eventHub.js';
import { formatSseFrame } from './realtime/sse.js';
import { GatewayHttpAccountIconSource } from './auth/accountIconSource.js';
import { createAdminProfileIconResetFlushHandler } from './services/accountIconSync.js';
import { AccountIconResetReconciler } from './services/accountIconResetReconciler.js';
import { createBestEffortResourceCloser } from './services/bestEffortResourceCloser.js';

const extractBearerToken = (value: string | string[] | undefined): string | null => {
    if (!value) {
        return null;
    }
    const header = Array.isArray(value) ? value[0] : value;
    if (!header) {
        return null;
    }
    const prefix = 'Bearer ';
    if (header.startsWith(prefix)) {
        return header.slice(prefix.length).trim();
    }
    return header.trim();
};

const resolveAuthFromToken = async (
    token: string | null,
    accessTokenStore: RedisAccessTokenStore,
    flushStore: FlushStore
): Promise<GameSessionTokenPayload | null> => {
    if (!token) {
        return null;
    }
    const stored = await accessTokenStore.get(token);
    if (!stored) {
        return null;
    }
    const flushedAt = flushStore.getFlushedAt(stored.user.id);
    if (flushedAt && new Date(stored.issuedAt) <= flushedAt) {
        return null;
    }
    return stored;
};

export const createGameApiServer = async () => {
    const config = resolveGameApiConfigFromEnv();
    const app = fastify({
        logger: true,
        routerOptions: {
            maxParamLength: 2048,
        },
    });
    const postgres = createGamePostgresConnector(resolvePostgresConfigFromEnv({ schema: config.profile }));
    const redis = createRedisConnector(resolveRedisConfigFromEnv());

    await postgres.connect();
    try {
        await redis.connect();
    } catch (error) {
        await postgres.disconnect();
        throw error;
    }
    const accountIconSource = new GatewayHttpAccountIconSource(config.gatewayInternalApiUrl, config.gameTokenSecret);

    const turnDaemon = new DatabaseTurnDaemonTransport(postgres.prisma, config.daemonRequestTimeoutMs);
    const accountIconResetReconciler = new AccountIconResetReconciler(
        postgres.prisma,
        accountIconSource,
        turnDaemon,
        config.accountIconResetReconcileIntervalMs,
        (error) => app.log.error({ err: error }, 'account icon reset reconciliation failed')
    );
    const battleSim = new RedisBattleSimTransport(redis.client, {
        keys: buildBattleSimQueueKeys(config.profileName),
        requestTimeoutMs: config.battleSimRequestTimeoutMs,
        resultTtlSeconds: config.battleSimResultTtlSeconds,
    });
    const flushStore = new InMemoryFlushStore();
    const flushSubscriberClient = redis.client.duplicate();
    try {
        await flushSubscriberClient.connect();
    } catch (error) {
        await redis.disconnect();
        await postgres.disconnect();
        throw error;
    }
    const flushSubscriber = new RedisGatewayFlushSubscriber(
        flushSubscriberClient,
        config.flushChannel,
        flushStore,
        createAdminProfileIconResetFlushHandler(accountIconSource, turnDaemon),
        (error, event) => {
            app.log.error({ err: error, userId: event.userId, reason: event.reason }, 'gateway flush handler failed');
        }
    );
    const accessTokenStore = new RedisAccessTokenStore(redis.client, config.profileName);
    const realtimeSubscriberClient = redis.client.duplicate();
    try {
        await realtimeSubscriberClient.connect();
    } catch (error) {
        await flushSubscriberClient.quit();
        await redis.disconnect();
        await postgres.disconnect();
        throw error;
    }
    const realtimeHub = new RedisRealtimeEventHub(realtimeSubscriberClient, buildGameEventChannel(config.profileName));
    let flushSubscriberStarted = false;
    let realtimeHubStarted = false;
    const closeResources = createBestEffortResourceCloser([
        {
            name: 'account-icon-reset-reconciler',
            run: () => accountIconResetReconciler.stop(),
        },
        {
            name: 'gateway-flush-subscriber',
            run: async () => {
                if (flushSubscriberStarted) await flushSubscriber.stop();
            },
        },
        {
            name: 'gateway-flush-redis-client',
            run: async () => {
                await flushSubscriberClient.quit();
            },
        },
        {
            name: 'realtime-redis-client',
            run: async () => {
                if (realtimeHubStarted) await realtimeHub.stop();
                else await realtimeSubscriberClient.quit();
            },
        },
        {
            name: 'redis',
            run: () => redis.disconnect(),
        },
        {
            name: 'postgres',
            run: () => postgres.disconnect(),
        },
    ]);

    app.addHook('onClose', closeResources);

    await app.register(cors, {
        origin: true,
        credentials: true,
    });

    await app.register(fastifyStatic, {
        root: path.resolve(process.cwd(), config.uploadDir),
        prefix: config.uploadPath.endsWith('/') ? config.uploadPath : `${config.uploadPath}/`,
    });

    await app.register(fastifyTRPCPlugin, {
        prefix: config.trpcPath,
        trpcOptions: {
            router: appRouter,
            createContext: async ({ req }: { req: FastifyRequest }) => {
                const token = extractBearerToken(req.headers.authorization);
                const auth = await resolveAuthFromToken(token, accessTokenStore, flushStore);
                return createGameApiContext({
                    requestId:
                        (Array.isArray(req.headers['idempotency-key'])
                            ? req.headers['idempotency-key'][0]
                            : req.headers['idempotency-key']) || undefined,
                    db: postgres.prisma,
                    redis: redis.client,
                    turnDaemon,
                    battleSim,
                    profile: {
                        id: config.profile,
                        scenario: config.scenario,
                        name: config.profileName,
                    },
                    uploadDir: path.resolve(process.cwd(), config.uploadDir),
                    uploadPath: config.uploadPath,
                    uploadPublicUrl: config.uploadPublicUrl,
                    auth,
                    ...(auth && token ? { accessToken: token } : {}),
                    accessTokenStore,
                    flushStore,
                    gameTokenSecret: config.gameTokenSecret,
                    accountIconSource,
                });
            },
        },
    });

    app.get(config.eventsPath, async (request, reply) => {
        const query = request.query as { token?: string };
        const tokenFromHeader = extractBearerToken(request.headers.authorization);
        const tokenFromQuery = typeof query.token === 'string' ? query.token : null;
        const auth = await resolveAuthFromToken(tokenFromHeader ?? tokenFromQuery, accessTokenStore, flushStore);

        if (!auth) {
            await reply.status(401).send({ ok: false, error: 'unauthorized' });
            return;
        }

        reply.hijack();
        const requestOrigin = request.headers.origin;
        if (typeof requestOrigin === 'string' && requestOrigin.length > 0) {
            // Hijacked SSE responses bypass Fastify's normal CORS response hook.
            reply.raw.setHeader('Access-Control-Allow-Origin', requestOrigin);
            reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
            reply.raw.setHeader('Vary', 'Origin');
        }
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Accel-Buffering', 'no');
        request.raw.setTimeout(0);
        reply.raw.setTimeout?.(0);
        reply.raw.flushHeaders?.();

        const sendFrame = (payload: string) => {
            try {
                reply.raw.write(payload);
            } catch {
                return;
            }
        };

        sendFrame(
            formatSseFrame({
                event: 'ready',
                data: JSON.stringify({ at: new Date().toISOString() }),
            })
        );

        const unsubscribe = realtimeHub.subscribe((event) => {
            sendFrame(
                formatSseFrame({
                    event: event.type,
                    data: JSON.stringify(event),
                    id: event.at,
                })
            );
        });

        const heartbeat = setInterval(() => {
            sendFrame(
                formatSseFrame({
                    event: 'ping',
                    data: JSON.stringify({ at: new Date().toISOString() }),
                })
            );
        }, 15000);

        const close = () => {
            clearInterval(heartbeat);
            unsubscribe();
        };

        request.raw.on('close', close);
        request.raw.on('aborted', close);
    });

    app.get('/healthz', async () => ({
        ok: true,
        profile: config.profileName,
        accountIconReconciliation: accountIconResetReconciler.getHealth(),
    }));

    try {
        await realtimeHub.start();
        realtimeHubStarted = true;
        await flushSubscriber.start();
        flushSubscriberStarted = true;
        accountIconResetReconciler.start();
    } catch (error) {
        await closeResources();
        throw error;
    }

    return {
        app,
        config,
    };
};

export const runGameApiServer = async (): Promise<void> => {
    const { app, config } = await createGameApiServer();
    try {
        await app.listen({
            host: config.host,
            port: config.port,
        });
    } catch (error) {
        await app.close();
        throw error;
    }
};
