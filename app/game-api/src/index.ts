import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGameApiServer } from './server.js';

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

const isMain = (): boolean => {
    if (!process.argv[1]) {
        return false;
    }
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
};

if (isMain()) {
    runGameApiServer().catch((error) => {
        console.error('[game-api] failed to start', error);
        process.exitCode = 1;
    });
}
