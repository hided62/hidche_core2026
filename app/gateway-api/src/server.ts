import fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import type { PrismaClient } from '@prisma/client';
import {
    createPostgresConnector,
    createRedisConnector,
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
import { createGatewayProfileRepository } from './orchestrator/profileRepository.js';
import { GatewayOrchestrator } from './orchestrator/gatewayOrchestrator.js';
import { Pm2ProcessManager } from './orchestrator/pm2ProcessManager.js';
import { PnpmBuildRunner } from './orchestrator/buildRunner.js';
import { resolveWorkspaceRoot } from './orchestrator/workspaceRoot.js';
import { appRouter } from './router.js';

const buildEnvMap = (env: NodeJS.ProcessEnv): Record<string, string> => {
    const entries = Object.entries(env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
    );
    return Object.fromEntries(entries);
};

export const createGatewayApiServer = async () => {
    const config = resolveGatewayApiConfigFromEnv();
    const postgres = createPostgresConnector(resolvePostgresConfigFromEnv());
    const redis = createRedisConnector(resolveRedisConfigFromEnv());
    await postgres.connect();
    await redis.connect();

    const users = createPostgresUserRepository(
        postgres.prisma as PrismaClient
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

    const profiles = createGatewayProfileRepository(
        postgres.prisma as PrismaClient
    );
    const workspaceRoot = resolveWorkspaceRoot(config.workspaceRootHint);
    const processManager = new Pm2ProcessManager();
    const buildRunner = new PnpmBuildRunner();
    const baseEnv = buildEnvMap(process.env);
    const orchestrator = new GatewayOrchestrator({
        repository: profiles,
        processManager,
        buildRunner,
        processConfig: {
            workspaceRoot,
            redisKeyPrefix: config.redisKeyPrefix,
            gameTokenSecret: config.gameTokenSecret,
            baseEnv,
        },
        reconcileIntervalMs: config.orchestratorReconcileIntervalMs,
        scheduleIntervalMs: config.orchestratorScheduleIntervalMs,
        buildIntervalMs: config.orchestratorBuildIntervalMs,
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
                    adminToken: config.adminToken,
                    requestHeaders: req.headers,
                }),
        },
    });

    app.get('/healthz', async () => ({
        ok: true,
    }));

    if (config.orchestratorEnabled) {
        orchestrator.start();
    }

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
