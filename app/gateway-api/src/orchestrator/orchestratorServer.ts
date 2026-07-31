import {
    createGatewayPostgresConnector,
    type GatewayPrismaClient,
    resolvePostgresConfigFromEnv,
} from '@sammo-ts/infra';

import { resolveGatewayOrchestratorConfigFromEnv } from '../config.js';
import { createGatewayOrchestrator } from './orchestratorFactory.js';
import { installGatewayShutdownController } from '../lifecycle/shutdownController.js';

export const runGatewayOrchestrator = async (): Promise<void> => {
    const config = resolveGatewayOrchestratorConfigFromEnv();
    const postgres = createGatewayPostgresConnector(resolvePostgresConfigFromEnv({ schema: config.dbSchema }));
    await postgres.connect();

    const { orchestrator } = createGatewayOrchestrator(postgres.prisma as GatewayPrismaClient, config, process.env);

    orchestrator.start();
    installGatewayShutdownController({
        close: async () => {
            await orchestrator.stop();
            await postgres.disconnect();
        },
        onStopping: (reason) => console.info(`[gateway-orchestrator] stopping: ${reason}`),
        onError: (error, reason) => {
            console.error(`[gateway-orchestrator] shutdown failed (${reason})`, error);
            process.exitCode = 1;
        },
    });
    console.info('[gateway-orchestrator] started');
};
