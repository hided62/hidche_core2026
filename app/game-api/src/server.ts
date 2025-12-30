import fastify from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import {
    createPostgresConnector,
    createRedisConnector,
    resolvePostgresConfigFromEnv,
    resolveRedisConfigFromEnv,
} from '@sammo-ts/infra';

import { resolveGameApiConfigFromEnv } from './config.js';
import { createGameApiContext } from './context.js';
import { buildTurnDaemonStreamKeys } from './daemon/streamKeys.js';
import { RedisTurnDaemonTransport } from './daemon/redisTransport.js';
import { appRouter } from './router.js';

export const createGameApiServer = async () => {
    const config = resolveGameApiConfigFromEnv();
    const postgres = createPostgresConnector(resolvePostgresConfigFromEnv());
    const redis = createRedisConnector(resolveRedisConfigFromEnv());

    await postgres.connect();
    await redis.connect();

    const turnDaemon = new RedisTurnDaemonTransport(redis.client, {
        keys: buildTurnDaemonStreamKeys(config.profileName),
        requestTimeoutMs: config.daemonRequestTimeoutMs,
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
            createContext: () =>
                createGameApiContext({
                    db: postgres.prisma,
                    turnDaemon,
                    profile: {
                        id: config.profile,
                        scenario: config.scenario,
                        name: config.profileName,
                    },
                }),
        },
    });

    app.get('/healthz', async () => ({
        ok: true,
        profile: config.profileName,
    }));

    app.addHook('onClose', async () => {
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
