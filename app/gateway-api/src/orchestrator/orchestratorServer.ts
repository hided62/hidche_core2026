import {
    createGatewayPostgresConnector,
    type GatewayPrismaClient,
    resolvePostgresConfigFromEnv,
} from '@sammo-ts/infra';

import { resolveGatewayOrchestratorConfigFromEnv } from '../config.js';
import { createGatewayOrchestrator } from './orchestratorFactory.js';

export const runGatewayOrchestrator = async (): Promise<void> => {
    const config = resolveGatewayOrchestratorConfigFromEnv();
    const postgres = createGatewayPostgresConnector(resolvePostgresConfigFromEnv({ schema: config.dbSchema }));
    await postgres.connect();

    const { orchestrator } = createGatewayOrchestrator(postgres.prisma as GatewayPrismaClient, config, process.env);

    const stop = async (reason: string): Promise<void> => {
        console.info(`[gateway-orchestrator] stopping: ${reason}`);
        await orchestrator.stop();
        await postgres.disconnect();
    };

    process.on('SIGINT', () => void stop('SIGINT'));
    process.on('SIGTERM', () => void stop('SIGTERM'));

    orchestrator.start();
    console.info('[gateway-orchestrator] started');
};
