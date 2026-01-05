import fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import {
    createGatewayPostgresConnector,
    createRedisConnector,
    type GatewayPrismaClient,
    resolvePostgresConfigFromEnv,
    resolveRedisConfigFromEnv,
} from '@sammo-ts/infra';

import { resolveGatewayApiConfigFromEnv } from './config.js';
import { createGatewayApiContext } from './context.js';
import { RedisGatewayFlushPublisher } from './auth/flushPublisher.js';
import { KakaoOAuthClient } from './auth/kakaoClient.js';
import { RedisOAuthSessionStore } from './auth/oauthSessionStore.js';
import { createPostgresUserRepository } from './auth/postgresUserRepository.js';
import { RedisGatewaySessionService } from './auth/redisSessionService.js';
import { createGatewayOrchestrator } from './orchestrator/orchestratorFactory.js';
import { appRouter } from './router.js';
import { RepositoryProfileStatusService } from './lobby/profileStatusService.js';

export const createGatewayApiServer = async () => {
    const config = resolveGatewayApiConfigFromEnv();
    const postgres = createGatewayPostgresConnector(resolvePostgresConfigFromEnv({ schema: config.dbSchema }));
    const redis = createRedisConnector(resolveRedisConfigFromEnv());
    await postgres.connect();
    await redis.connect();

    const users = createPostgresUserRepository(postgres.prisma as GatewayPrismaClient);
    const sessions = new RedisGatewaySessionService(redis.client, {
        keyPrefix: config.redisKeyPrefix,
        sessionTtlSeconds: config.sessionTtlSeconds,
        gameSessionTtlSeconds: config.gameSessionTtlSeconds,
    });
    const flushPublisher = new RedisGatewayFlushPublisher(redis.client, config.flushChannel);
    const kakaoClient = new KakaoOAuthClient({
        restKey: config.kakaoRestKey,
        adminKey: config.kakaoAdminKey,
        redirectUri: config.kakaoRedirectUri,
    });
    const oauthSessions = new RedisOAuthSessionStore(
        redis.client,
        config.redisKeyPrefix,
        config.oauthSessionTtlSeconds
    );

    const { orchestrator, profiles } = createGatewayOrchestrator(
        postgres.prisma as GatewayPrismaClient,
        config,
        process.env
    );
    const profileStatus = new RepositoryProfileStatusService(profiles, orchestrator);

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
            createContext: ({ req }: { req: FastifyRequest }) =>
                createGatewayApiContext({
                    users,
                    sessions,
                    flushPublisher,
                    gameTokenSecret: config.gameTokenSecret,
                    gameSessionTtlSeconds: config.gameSessionTtlSeconds,
                    kakaoClient,
                    oauthSessions,
                    publicBaseUrl: config.publicBaseUrl,
                    profiles,
                    orchestrator,
                    profileStatus,
                    requestHeaders: req.headers,
                    prisma: postgres.prisma as GatewayPrismaClient,
                }),
        },
    });

    app.get('/healthz', async () => ({
        ok: true,
    }));

    app.addHook('onClose', async () => {
        await orchestrator.stop();
        await redis.disconnect();
        await postgres.disconnect();
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
