import { runGatewayApiServer } from './server.js';
import { runGatewayOrchestrator } from './orchestrator/orchestratorServer.js';
import { runProfileSeedCli } from './orchestrator/profileSeedCli.js';

export * from './config.js';
export * from './context.js';
export * from './router.js';
export * from './server.js';
import type { GatewayPrisma } from '@sammo-ts/infra';
export type JsonObject = GatewayPrisma.JsonObject;
export type JsonArray = GatewayPrisma.JsonArray;
export * from './orchestrator/profileRepository.js';
export * from './orchestrator/gatewayReleaseRepository.js';
export * from './orchestrator/gatewayOrchestrator.js';
export * from './orchestrator/seedProfileDatabase.js';
export * from './orchestrator/workspaceManager.js';
export * from './orchestrator/buildRunner.js';
export * from './orchestrator/processManager.js';
export * from './orchestrator/pm2ProcessManager.js';
export * from './orchestrator/releaseManifest.js';
export * from './orchestrator/frontendArtifactManager.js';
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

const GATEWAY_ROLES = ['api', 'orchestrator', 'profile-seed'] as const;
export const shouldRunGateway = (role: string | undefined): boolean =>
    typeof role === 'string' && GATEWAY_ROLES.includes(role as (typeof GATEWAY_ROLES)[number]);

if (shouldRunGateway(process.env.GATEWAY_ROLE)) {
    const role = process.env.GATEWAY_ROLE;
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
