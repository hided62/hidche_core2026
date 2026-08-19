import fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { trpcJsonBodyHttpServerOptions } from '@sammo-ts/common';
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
import { createPasswordHasher } from './auth/passwordHasher.js';
import { createPasswordEnvelopeService } from './auth/passwordEnvelope.js';
import { RedisGatewaySessionService } from './auth/redisSessionService.js';
import { createGatewayOrchestrator } from './orchestrator/orchestratorFactory.js';
import { createGatewayReleaseRepository } from './orchestrator/gatewayReleaseRepository.js';
import { appRouter } from './router.js';
import { RepositoryProfileStatusService } from './lobby/profileStatusService.js';
import { registerAccountIconInternalRoute } from './auth/accountIconInternalRoute.js';
import { registerProfileStatusInternalRoute } from './lobby/profileStatusInternalRoute.js';
import { installGatewayShutdownController } from './lifecycle/shutdownController.js';
import { RemoteUserIconStore } from './account/remoteUserIconStore.js';
import { gatewayFastifyRouterOptions } from './fastifyOptions.js';
import { RuntimeNavigationConfigStore } from './navigation/runtimeNavigationConfig.js';

export const createGatewayApiServer = async () => {
    const config = resolveGatewayApiConfigFromEnv();
    const postgres = createGatewayPostgresConnector(resolvePostgresConfigFromEnv({ schema: config.dbSchema }));
    const redis = createRedisConnector(resolveRedisConfigFromEnv());
    await postgres.connect();
    await redis.connect();

    const privateKeyPem = config.passwordEncryptionPrivateKeyFile
        ? await fs.readFile(config.passwordEncryptionPrivateKeyFile, 'utf8')
        : undefined;
    const passwordEnvelope = createPasswordEnvelopeService(privateKeyPem);
    const imageUploadSecret = (await fs.readFile(config.imageUploadSecretFile, 'utf8')).trim();
    if (imageUploadSecret.length < 32) {
        throw new Error('GATEWAY_IMAGE_UPLOAD_SECRET_FILE must contain at least 32 characters.');
    }
    const userIconUpload = new RemoteUserIconStore(
        config.imageUploadBaseUrl,
        config.sharedIconPublicUrl,
        imageUploadSecret
    );
    const users = createPostgresUserRepository(
        postgres.prisma as GatewayPrismaClient,
        createPasswordHasher({ legacyGlobalSalt: config.legacyPasswordGlobalSalt })
    );
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
    const releases = createGatewayReleaseRepository(postgres.prisma as GatewayPrismaClient);
    const profileStatus = new RepositoryProfileStatusService(profiles, orchestrator);
    const navigationConfig = new RuntimeNavigationConfigStore(
        config.navigationConfigFile,
        config.defaultNavigationConfigFile
    );

    const app = fastify({
        logger: true,
        routerOptions: gatewayFastifyRouterOptions,
    });

    await app.register(cors, {
        origin: true,
        credentials: true,
    });
    await fs.mkdir(path.resolve(process.cwd(), config.userIconDir), { recursive: true });
    await app.register(fastifyStatic, {
        root: path.resolve(process.cwd(), config.userIconDir),
        prefix: '/user-icons/',
        decorateReply: false,
    });
    registerAccountIconInternalRoute(app, {
        users,
        secret: config.gameTokenSecret,
    });
    registerProfileStatusInternalRoute(app, {
        profiles,
        secret: config.gameTokenSecret,
    });
    app.get(config.trpcPath.replace(/\/trpc\/?$/u, '/navigation'), async (_request, reply) => {
        void reply.header('Cache-Control', 'no-store');
        return navigationConfig.get();
    });

    await app.register(fastifyTRPCPlugin, {
        prefix: config.trpcPath,
        trpcOptions: {
            router: appRouter,
            ...trpcJsonBodyHttpServerOptions,
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
                    userIconDir: path.resolve(process.cwd(), config.userIconDir),
                    userIconPublicUrl: config.userIconPublicUrl,
                    sharedIconPublicUrl: config.sharedIconPublicUrl,
                    userIconUpload,
                    adminLocalAccountEnabled: config.adminLocalAccountEnabled,
                    localRegistrationEnabled: config.localRegistrationEnabled,
                    localAccountGraceDays: config.localAccountGraceDays,
                    passwordEnvelope,
                    profiles,
                    releases,
                    orchestrator,
                    profileStatus,
                    requestHeaders: req.headers,
                    prisma: postgres.prisma as GatewayPrismaClient,
                    navigationConfig,
                }),
        },
    });

    app.get('/healthz', async () => ({
        ok: true,
        postgresPool: postgres.getPoolStats(),
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
    const shutdown = installGatewayShutdownController({
        close: () => app.close(),
        onStopping: (reason) => app.log.info({ reason }, 'gateway API stopping'),
        onError: (error, reason) => {
            app.log.error({ err: error, reason }, 'gateway API shutdown failed');
            process.exitCode = 1;
        },
    });
    app.addHook('onClose', async () => shutdown.dispose());
    try {
        await app.listen({
            host: config.host,
            port: config.port,
        });
    } catch (error) {
        shutdown.dispose();
        await app.close();
        throw error;
    }
};
