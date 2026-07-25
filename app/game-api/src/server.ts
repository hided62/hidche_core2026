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
    const postgres = createGamePostgresConnector(resolvePostgresConfigFromEnv({ schema: config.profile }));
    const redis = createRedisConnector(resolveRedisConfigFromEnv());

    await postgres.connect();
    await redis.connect();

    const turnDaemon = new DatabaseTurnDaemonTransport(postgres.prisma, config.daemonRequestTimeoutMs);
    const battleSim = new RedisBattleSimTransport(redis.client, {
        keys: buildBattleSimQueueKeys(config.profileName),
        requestTimeoutMs: config.battleSimRequestTimeoutMs,
        resultTtlSeconds: config.battleSimResultTtlSeconds,
    });
    const flushStore = new InMemoryFlushStore();
    const flushSubscriberClient = redis.client.duplicate();
    await flushSubscriberClient.connect();
    const flushSubscriber = new RedisGatewayFlushSubscriber(flushSubscriberClient, config.flushChannel, flushStore);
    await flushSubscriber.start();
    const accessTokenStore = new RedisAccessTokenStore(redis.client, config.profileName);
    const realtimeSubscriberClient = redis.client.duplicate();
    await realtimeSubscriberClient.connect();
    const realtimeHub = new RedisRealtimeEventHub(realtimeSubscriberClient, buildGameEventChannel(config.profileName));
    await realtimeHub.start();

    const app = fastify({
        logger: true,
        routerOptions: {
            maxParamLength: 2048,
        },
    });

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
                    accessTokenStore,
                    flushStore,
                    gameTokenSecret: config.gameTokenSecret,
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
    }));

    app.addHook('onClose', async () => {
        await flushSubscriber.stop();
        await flushSubscriberClient.quit();
        await realtimeHub.stop();
        await redis.disconnect();
        await postgres.disconnect();
    });

    return {
        app,
        config,
    };
};

export const runGameApiServer = async (): Promise<void> => {
    const { app, config } = await createGameApiServer();
    await app.listen({
        host: config.host,
        port: config.port,
    });
};
