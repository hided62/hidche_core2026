import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGatewayApiServer } from './server.js';
import { runGatewayOrchestrator } from './orchestrator/orchestratorServer.js';
import { runProfileSeedCli } from './orchestrator/profileSeedCli.js';

export * from './config.js';
export * from './context.js';
export * from './router.js';
export * from './server.js';
import { GatewayPrisma } from '@sammo-ts/infra';
export { GatewayPrisma };
export type JsonObject = GatewayPrisma.JsonObject;
export type JsonArray = GatewayPrisma.JsonArray;
export * from './orchestrator/profileRepository.js';
export * from './orchestrator/gatewayOrchestrator.js';
export * from './auth/userRepository.js';
export * from './auth/passwordHasher.js';
export * from './auth/inMemoryUserRepository.js';
export * from './auth/sessionService.js';
export * from './auth/inMemorySessionService.js';
export * from './auth/redisSessionService.js';
export * from './auth/redisKeys.js';
export * from './auth/flushPublisher.js';
export * from './auth/kakaoClient.js';
export * from './auth/oauthSessionStore.js';
export * from './auth/postgresUserRepository.js';

const isMain = (): boolean => {
    if (!process.argv[1]) {
        return false;
    }
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
};

if (isMain()) {
    const role = process.env.GATEWAY_ROLE ?? 'api';
    const run =
        role === 'orchestrator'
            ? runGatewayOrchestrator
            : role === 'profile-seed'
              ? runProfileSeedCli
              : runGatewayApiServer;
    run().catch((error) => {
        const prefix =
            role === 'orchestrator' ? 'gateway-orchestrator' : role === 'profile-seed' ? 'profile-seed' : 'gateway-api';
        console.error(`[${prefix}] failed to start`, error);
        process.exitCode = 1;
    });
}
