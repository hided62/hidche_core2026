import fastify from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { createRedisConnector, resolveRedisConfigFromEnv } from '@sammo-ts/infra';

import { resolveGatewayApiConfigFromEnv } from './config.js';
import { createGatewayApiContext } from './context.js';
import { createInMemoryUserRepository } from './auth/inMemoryUserRepository.js';
import { RedisGatewaySessionService } from './auth/redisSessionService.js';
import { appRouter } from './router.js';

export const createGatewayApiServer = async () => {
    const config = resolveGatewayApiConfigFromEnv();
    const redis = createRedisConnector(resolveRedisConfigFromEnv());
    await redis.connect();

    const users = createInMemoryUserRepository();
    const sessions = new RedisGatewaySessionService(redis.client, {
        keyPrefix: config.redisKeyPrefix,
        sessionTtlSeconds: config.sessionTtlSeconds,
        gameSessionTtlSeconds: config.gameSessionTtlSeconds,
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
                createGatewayApiContext({
                    users,
                    sessions,
                }),
        },
    });

    app.get('/healthz', async () => ({
        ok: true,
    }));

    app.addHook('onClose', async () => {
        await redis.disconnect();
    });

    return {
        app,
        config,
    };
};

export const runGatewayApiServer = async (): Promise<void> => {
    const { app, config } = await createGatewayApiServer();
    await app.listen({
        host: config.host,
        port: config.port,
    });
};
