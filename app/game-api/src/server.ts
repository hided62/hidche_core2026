import fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import {
    createGamePostgresConnector,
    createRedisConnector,
    resolvePostgresConfigFromEnv,
    resolveRedisConfigFromEnv,
} from '@sammo-ts/infra';

import { resolveGameApiConfigFromEnv } from './config.js';
import { createGameApiContext, type DatabaseClient } from './context.js';
import { buildTurnDaemonStreamKeys } from './daemon/streamKeys.js';
import { RedisTurnDaemonTransport } from './daemon/redisTransport.js';
import { InMemoryFlushStore, RedisGatewayFlushSubscriber } from './auth/flushStore.js';
import { createGameTokenVerifier } from './auth/tokenVerifier.js';
import { appRouter } from './router.js';
import { buildBattleSimQueueKeys } from './battleSim/keys.js';
import { RedisBattleSimTransport } from './battleSim/redisTransport.js';

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

export const createGameApiServer = async () => {
    const config = resolveGameApiConfigFromEnv();
    const postgres = createGamePostgresConnector(
        resolvePostgresConfigFromEnv({ schema: config.profile })
    );
    const redis = createRedisConnector(resolveRedisConfigFromEnv());

    await postgres.connect();
    await redis.connect();

    const turnDaemon = new RedisTurnDaemonTransport(redis.client, {
        keys: buildTurnDaemonStreamKeys(config.profileName),
        requestTimeoutMs: config.daemonRequestTimeoutMs,
    });
    const battleSim = new RedisBattleSimTransport(redis.client, {
        keys: buildBattleSimQueueKeys(config.profileName),
        requestTimeoutMs: config.battleSimRequestTimeoutMs,
        resultTtlSeconds: config.battleSimResultTtlSeconds,
    });
    const flushStore = new InMemoryFlushStore();
    const flushSubscriberClient = redis.client.duplicate();
    await flushSubscriberClient.connect();
    const flushSubscriber = new RedisGatewayFlushSubscriber(
        flushSubscriberClient,
        config.flushChannel,
        flushStore
    );
    await flushSubscriber.start();
    const tokenVerifier = createGameTokenVerifier({
        secret: config.gameTokenSecret,
        profileName: config.profileName,
        flushStore,
    });

    const app = fastify({
        logger: true,
    });

    await app.register(cors, {
        origin: true,
        credentials: true,
    });

    await app.register(fastifyTRPCPlugin, {
        prefix: config.trpcPath,
        trpcOptions: {
            router: appRouter,
            createContext: ({ req }: { req: FastifyRequest }) => {
                const token = extractBearerToken(req.headers.authorization);
                const auth = token ? tokenVerifier.verify(token) : null;
                return createGameApiContext({
                    db: postgres.prisma,
                    redis: redis.client,
                    turnDaemon,
                    battleSim,
                    profile: {
                        id: config.profile,
                        scenario: config.scenario,
                        name: config.profileName,
                    },
                    auth,
                });
            },
        },
    });

    app.get('/healthz', async () => ({
        ok: true,
        profile: config.profileName,
    }));


    app.addHook('onClose', async () => {
        await flushSubscriber.stop();
        await flushSubscriberClient.quit();
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
