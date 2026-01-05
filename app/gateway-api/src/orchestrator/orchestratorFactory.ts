import type { GatewayPrismaClient } from '@sammo-ts/infra';

import type { GatewayOrchestratorConfig } from '../config.js';
import { createGatewayProfileRepository } from './profileRepository.js';
import { GatewayOrchestrator } from './gatewayOrchestrator.js';
import { Pm2ProcessManager } from './pm2ProcessManager.js';
import { PnpmBuildRunner } from './buildRunner.js';
import { resolveWorkspaceRoot } from './workspaceRoot.js';
import { GitWorkspaceManager } from './workspaceManager.js';

export const buildEnvMap = (env: NodeJS.ProcessEnv): Record<string, string> => {
    const entries = Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    return Object.fromEntries(entries);
};

export const createGatewayOrchestrator = (
    prisma: GatewayPrismaClient,
    config: GatewayOrchestratorConfig,
    env: NodeJS.ProcessEnv = process.env
): {
    orchestrator: GatewayOrchestrator;
    profiles: ReturnType<typeof createGatewayProfileRepository>;
} => {
    const profiles = createGatewayProfileRepository(prisma);
    const workspaceRoot = resolveWorkspaceRoot(config.workspaceRootHint);
    const processManager = new Pm2ProcessManager();
    const buildRunner = new PnpmBuildRunner();
    const baseEnv = buildEnvMap(env);
    const workspaceManager = new GitWorkspaceManager({
        repoRoot: workspaceRoot,
        worktreeRoot: config.worktreeRoot,
        baseEnv,
    });
    const orchestrator = new GatewayOrchestrator({
        repository: profiles,
        processManager,
        buildRunner,
        workspaceManager,
        processConfig: {
            workspaceRoot,
            redisKeyPrefix: config.redisKeyPrefix,
            gameTokenSecret: config.gameTokenSecret,
            baseEnv,
        },
        reconcileIntervalMs: config.orchestratorReconcileIntervalMs,
        scheduleIntervalMs: config.orchestratorScheduleIntervalMs,
        buildIntervalMs: config.orchestratorBuildIntervalMs,
        adminActionIntervalMs: config.orchestratorAdminIntervalMs,
    });
    return { orchestrator, profiles };
};
