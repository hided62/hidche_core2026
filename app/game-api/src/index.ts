import { runGameApiServer } from './server.js';
import { runBattleSimWorker } from './battleSim/worker.js';
import { runAuctionWorker } from './auction/worker.js';
import { runTournamentWorker } from './tournament/worker.js';

export * from './config.js';
export * from './context.js';
export * from './inputEventBoundary.js';
export * from './router.js';
export * from './server.js';
export * from './daemon/types.js';
export * from './daemon/streamKeys.js';
export * from './daemon/transport.js';
export * from './daemon/databaseTransport.js';
export * from './daemon/idempotentTransport.js';
export * from './daemon/inMemoryTransport.js';
export * from './auth/flushStore.js';
export * from './battleSim/types.js';
export * from './battleSim/transport.js';
export * from './battleSim/redisTransport.js';
export * from './battleSim/inMemoryTransport.js';
export * from './battleSim/keys.js';
export * from './battleSim/worker.js';
export * from './auction/types.js';
export * from './auction/keys.js';
export * from './auction/scheduler.js';
export * from './auction/worker.js';
export * from './tournament/keys.js';
export * from './tournament/store.js';
export * from './tournament/types.js';
export * from './tournament/worker.js';

// Types for TRPC consumer
export type { MessageView } from './messages/store.js';
export type { TurnCommandTable } from './turns/commandTable.js';
export type { ReservedTurnView } from './turns/reservedTurns.js';
export type { JsonObject, JsonArray } from './context.js';

const GAME_API_ROLES = ['server', 'battle-sim-worker', 'auction-worker', 'tournament-worker'] as const;
export const shouldRunGameApi = (role: string | undefined): boolean =>
    typeof role === 'string' && GAME_API_ROLES.includes(role as (typeof GAME_API_ROLES)[number]);

if (shouldRunGameApi(process.env.GAME_API_ROLE)) {
    const role = process.env.GAME_API_ROLE;
    const run =
        role === 'battle-sim-worker'
            ? runBattleSimWorker
            : role === 'auction-worker'
              ? runAuctionWorker
              : role === 'tournament-worker'
                ? runTournamentWorker
                : runGameApiServer;
    run().catch((error) => {
        console.error('[game-api] failed to start', error);
        process.exitCode = 1;
    });
}
