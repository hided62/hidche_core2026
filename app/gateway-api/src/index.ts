import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGatewayApiServer } from './server.js';

export * from './config.js';
export * from './context.js';
export * from './router.js';
export * from './server.js';
export * from './auth/userRepository.js';
export * from './auth/passwordHasher.js';
export * from './auth/inMemoryUserRepository.js';
export * from './auth/sessionService.js';
export * from './auth/inMemorySessionService.js';
export * from './auth/redisSessionService.js';
export * from './auth/redisKeys.js';

const isMain = (): boolean => {
    if (!process.argv[1]) {
        return false;
    }
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
};

if (isMain()) {
    runGatewayApiServer().catch((error) => {
        console.error('[gateway-api] failed to start', error);
        process.exitCode = 1;
    });
}
