import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGameApiServer } from './server.js';
import { runBattleSimWorker } from './battleSim/worker.js';
import { runAuctionWorker } from './auction/worker.js';

export * from './config.js';
export * from './context.js';
export * from './router.js';
export * from './server.js';
export * from './daemon/types.js';
export * from './daemon/streamKeys.js';
export * from './daemon/transport.js';
export * from './daemon/inMemoryTransport.js';
export * from './daemon/redisTransport.js';
export * from './auth/flushStore.js';
export * from './auth/tokenVerifier.js';
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

// Types for TRPC consumer
export type { MessageView } from './messages/store.js';
export type { TurnCommandTable } from './turns/commandTable.js';
export type { ReservedTurnView } from './turns/reservedTurns.js';
export type { JsonObject, JsonArray } from './context.js';

const isMain = (): boolean => {
    if (typeof process.env.NODE_APP_INSTANCE === 'string') {
        return true;
    }
    if (!process.argv[1]) {
        return false;
    }
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
};

if (isMain()) {
    const role = process.env.GAME_API_ROLE ?? 'server';
    const run =
        role === 'battle-sim-worker'
            ? runBattleSimWorker
            : role === 'auction-worker'
              ? runAuctionWorker
              : runGameApiServer;
    run().catch((error) => {
        console.error('[game-api] failed to start', error);
        process.exitCode = 1;
    });
}
