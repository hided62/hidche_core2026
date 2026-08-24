import fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'node:fs/promises';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import {
    buildGameEventChannel,
    REALTIME_ACCESS_GRANT_HEADER,
    trpcJsonBodyHttpServerOptions,
    type RealtimeViewerIdentity,
} from '@sammo-ts/common';
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
import {
    consumeRealtimeAccessGrantHeader,
    createRealtimeAccessGrant,
    registerRealtimeAccessGrant,
} from './auth/realtimeAccessGrant.js';
import { appRouter } from './router.js';
import { buildBattleSimQueueKeys } from './battleSim/keys.js';
import { RedisBattleSimTransport } from './battleSim/redisTransport.js';
import { RedisRealtimeEventHub } from './realtime/eventHub.js';
import { formatSseFrame } from './realtime/sse.js';
import {
    shouldForwardRealtimeEvent,
    shouldReloadRealtimeViewerIdentity,
    toPublicRealtimeEvent,
} from './realtime/publicEvent.js';
import { GatewayHttpAccountIconSource } from './auth/accountIconSource.js';
import { GatewayHttpProfileStatusSource } from './auth/profileStatusSource.js';
import { CachedTurnEngineStatus } from './services/turnEngineStatus.js';
import { createAdminProfileIconResetFlushHandler } from './services/accountIconSync.js';
import { createAccountIdentityFlushHandler } from './services/accountIdentitySync.js';
import { AccountIconResetReconciler } from './services/accountIconResetReconciler.js';
import { createBestEffortResourceCloser } from './services/bestEffortResourceCloser.js';
import { RemoteContentImageStore } from './services/remoteContentImageStore.js';
import { ReadModelOutboxWorker } from './realtime/outboxWorker.js';
import { DeferredGeneralAccessWorker } from './services/deferredGeneralAccess.js';
import { WebPushOutboxWorker } from './services/webPushOutboxWorker.js';
import { scopeHttpIdempotencyKey } from './requestId.js';

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
    const imageUploadSecret = (await fs.readFile(config.imageUploadSecretFile, 'utf8')).trim();
    if (imageUploadSecret.length < 32) {
        throw new Error('GAME_IMAGE_UPLOAD_SECRET_FILE must contain at least 32 characters.');
    }
    const contentImageUpload = new RemoteContentImageStore(
        config.imageUploadBaseUrl,
        config.contentImagePublicUrl,
        imageUploadSecret
    );
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
    const profileStatusSource = new GatewayHttpProfileStatusSource(
        config.gatewayInternalApiUrl,
        config.gameTokenSecret
    );
    const turnEngineStatus = new CachedTurnEngineStatus(profileStatusSource, postgres.prisma, config.profileName);

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
    const iconFlushHandler = createAdminProfileIconResetFlushHandler(accountIconSource, turnDaemon);
    const identityFlushHandler = createAccountIdentityFlushHandler(turnDaemon);
    const flushSubscriber = new RedisGatewayFlushSubscriber(
        flushSubscriberClient,
        config.flushChannel,
        flushStore,
        async (event) => {
            await Promise.all([iconFlushHandler(event), identityFlushHandler(event)]);
        },
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
    const readModelOutboxWorker = new ReadModelOutboxWorker(postgres.prisma, redis.client, config.profileName, {
        onError: (error) => app.log.error({ err: error }, 'read-model outbox dispatch failed'),
    });
    const deferredGeneralAccessWorker = new DeferredGeneralAccessWorker(
        postgres.prisma,
        redis.client,
        config.profileName,
        profileStatusSource,
        {
            onError: (error) => app.log.error({ err: error }, 'deferred general access flush failed'),
        }
    );
    const webPushOutboxWorker = new WebPushOutboxWorker(
        postgres.prisma,
        config.gatewayInternalApiUrl,
        config.gameTokenSecret,
        config.profileName,
        {
            intervalMs: config.webPushOutboxPollMs,
            onError: (error) => app.log.error({ err: error }, 'web push outbox dispatch failed'),
        }
    );
    let flushSubscriberStarted = false;
    let realtimeHubStarted = false;
    const closeResources = createBestEffortResourceCloser([
        {
            name: 'web-push-outbox-worker',
            run: () => webPushOutboxWorker.stop(),
        },
        {
            name: 'deferred-general-access-worker',
            run: () => deferredGeneralAccessWorker.stop(),
        },
        {
            name: 'read-model-outbox-worker',
            run: () => readModelOutboxWorker.stop(),
        },
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
            ...trpcJsonBodyHttpServerOptions,
            createContext: async ({ req }: { req: FastifyRequest }) => {
                const token = extractBearerToken(req.headers.authorization);
                const auth = await resolveAuthFromToken(token, accessTokenStore, flushStore);
                const rawIdempotencyKey = Array.isArray(req.headers['idempotency-key'])
                    ? req.headers['idempotency-key'][0]
                    : req.headers['idempotency-key'];
                return createGameApiContext({
                    requestId: scopeHttpIdempotencyKey({
                        rawKey: rawIdempotencyKey,
                        profileId: config.profile,
                        userId: auth?.user.id ?? null,
                    }),
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
                    contentImageUpload,
                    auth,
                    realtimeAccessGranted: await consumeRealtimeAccessGrantHeader(
                        redis.client,
                        req.headers[REALTIME_ACCESS_GRANT_HEADER],
                        auth,
                        config.profileName,
                        config.gameTokenSecret
                    ),
                    ...(auth && token ? { accessToken: token } : {}),
                    accessTokenStore,
                    flushStore,
                    gameTokenSecret: config.gameTokenSecret,
                    accountIconSource,
                    profileStatusSource,
                    readModelOutbox: readModelOutboxWorker,
                });
            },
        },
    });

    app.get(config.eventsPath, async (request, reply) => {
        const query = request.query as { token?: string; scope?: string };
        const subscriptionScope = query.scope === 'tournament' ? 'tournament' : 'dashboard';
        const tokenFromHeader = extractBearerToken(request.headers.authorization);
        const tokenFromQuery = typeof query.token === 'string' ? query.token : null;
        const auth = await resolveAuthFromToken(tokenFromHeader ?? tokenFromQuery, accessTokenStore, flushStore);

        if (!auth) {
            await reply.status(401).send({ ok: false, error: 'unauthorized' });
            return;
        }

        const loadViewerIdentity = async (): Promise<RealtimeViewerIdentity> => {
            const general = await postgres.prisma.general.findFirst({
                where: { userId: auth.user.id, npcState: 0 },
                select: { id: true, cityId: true, nationId: true },
            });
            return general
                ? { generalId: general.id, cityId: general.cityId, nationId: general.nationId }
                : { generalId: null, cityId: null, nationId: null };
        };
        let viewerIdentity = await loadViewerIdentity();

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
                data: '{}',
            })
        );

        let closed = false;
        let eventQueue = Promise.resolve();
        const unsubscribe = realtimeHub.subscribe((event) => {
            if (!shouldForwardRealtimeEvent(event, subscriptionScope)) return;
            eventQueue = eventQueue
                .then(async () => {
                    if (closed) return;
                    const identities = [viewerIdentity];
                    if (shouldReloadRealtimeViewerIdentity(event, viewerIdentity)) {
                        const nextIdentity = await loadViewerIdentity();
                        identities.push(nextIdentity);
                        viewerIdentity = nextIdentity;
                    }
                    let refreshGrant: string | undefined;
                    const publicEvent = toPublicRealtimeEvent(event, identities, () => {
                        refreshGrant ??= createRealtimeAccessGrant(auth, config.profileName, config.gameTokenSecret);
                        return refreshGrant;
                    });
                    if (!publicEvent || closed) return;
                    if (refreshGrant) {
                        try {
                            await registerRealtimeAccessGrant(redis.client, refreshGrant, config.profileName);
                        } catch {
                            // Preserve the invalidation. An unregistered grant safely falls back
                            // to the normal scored refresh path.
                        }
                    }
                    sendFrame(
                        formatSseFrame({
                            event: publicEvent.type,
                            data: JSON.stringify(publicEvent),
                        })
                    );
                })
                .catch(() => {
                    // A best-effort notification must not affect committed game state.
                });
        });

        let heartbeatPending = false;
        const heartbeat = setInterval(() => {
            if (heartbeatPending) return;
            heartbeatPending = true;
            void turnEngineStatus
                .get()
                .then((turnEngineRunning) => {
                    if (closed) return;
                    sendFrame(
                        formatSseFrame({
                            event: 'ping',
                            data: JSON.stringify({ turnEngineRunning }),
                        })
                    );
                })
                .finally(() => {
                    heartbeatPending = false;
                });
        }, 15000);

        const close = () => {
            closed = true;
            clearInterval(heartbeat);
            unsubscribe();
        };

        request.raw.on('close', close);
        request.raw.on('aborted', close);
    });

    app.get('/healthz', async () => ({
        ok: true,
        profile: config.profileName,
        postgresPool: postgres.getPoolStats(),
        accountIconReconciliation: accountIconResetReconciler.getHealth(),
    }));

    try {
        await realtimeHub.start();
        realtimeHubStarted = true;
        await flushSubscriber.start();
        flushSubscriberStarted = true;
        readModelOutboxWorker.start();
        webPushOutboxWorker.start();
        deferredGeneralAccessWorker.start();
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
