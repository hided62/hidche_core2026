import { createGatewayPostgresConnector, type GatewayPrismaClient } from '@sammo-ts/infra';
import {
    createGatewayReleaseRepository,
    GitWorkspaceManager,
    Pm2ProcessManager,
    PnpmBuildRunner,
} from '@sammo-ts/gateway-api';

import { resolveReleaseControllerConfig } from './config.js';
import { GatewayReleaseController } from './releaseController.js';
import { upgradeReleaseController } from './selfUpgrade.js';

export * from './config.js';
export * from './releaseController.js';
export * from './selfUpgrade.js';

const main = async (): Promise<void> => {
    const config = resolveReleaseControllerConfig();
    const postgres = createGatewayPostgresConnector({
        url: config.gatewayDatabaseUrl,
        maxConnections: config.postgresPoolMax,
    });
    await postgres.connect();
    const repository = createGatewayReleaseRepository(postgres.prisma as GatewayPrismaClient);
    const workspaceManager = new GitWorkspaceManager({
        repoRoot: config.workspaceRoot,
        worktreeRoot: config.worktreeRoot,
        baseEnv: config.baseEnv,
    });
    const buildRunner = new PnpmBuildRunner();
    const processManager = new Pm2ProcessManager();
    const controller = new GatewayReleaseController(repository, workspaceManager, buildRunner, processManager, config);
    const command = process.argv[2] ?? 'daemon';
    if (command === 'status') {
        console.log(
            JSON.stringify(
                { state: await repository.getState(), operations: await repository.listOperations(20) },
                null,
                2
            )
        );
        await postgres.disconnect();
        return;
    }
    if (command === 'run-once') {
        console.log(JSON.stringify(await controller.runOnce(), null, 2));
        await postgres.disconnect();
        return;
    }
    if (command === 'self-upgrade') {
        const sourceMode = process.argv[3];
        const sourceRef = process.argv[4];
        if ((sourceMode !== 'BRANCH' && sourceMode !== 'COMMIT') || !sourceRef) {
            throw new Error('usage: release-controller self-upgrade <BRANCH|COMMIT> <ref>');
        }
        const result = await upgradeReleaseController({
            sourceMode,
            sourceRef,
            workspaceManager,
            buildRunner,
            processManager,
            config,
        });
        console.log(JSON.stringify(result, null, 2));
        await postgres.disconnect();
        return;
    }
    if (command !== 'daemon') throw new Error(`Unknown release-controller command: ${command}`);
    let stopping = false;
    const stop = async (): Promise<void> => {
        if (stopping) return;
        stopping = true;
        await postgres.disconnect();
    };
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
    while (!stopping) {
        await controller.runOnce();
        await new Promise<void>((resolve) => setTimeout(resolve, config.pollIntervalMs));
    }
};

main().catch((error) => {
    console.error('[release-controller] failed', error);
    process.exitCode = 1;
});
