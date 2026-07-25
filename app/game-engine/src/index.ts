import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTurnDaemonCli } from './turn/cli.js';

export * from './lifecycle/types.js';
export * from './lifecycle/clock.js';
export * from './lifecycle/databaseCommandQueue.js';
export * from './lifecycle/inMemoryControlQueue.js';
export * from './lifecycle/turnDaemonLifecycle.js';
export * from './lifecycle/getNextTickTime.js';
export * from './scenario/scenarioLoader.js';
export * from './scenario/databaseUrl.js';
export * from './scenario/mapLoader.js';
export * from './scenario/scenarioSeeder.js';
export * from './turn/types.js';
export * from './turn/worldLoader.js';
export * from './turn/inMemoryWorld.js';
export * from './turn/inMemoryStateStore.js';
export * from './turn/inMemoryTurnProcessor.js';
export * from './turn/databaseHooks.js';
export * from './turn/turnDaemon.js';
export * from './turn/cli.js';

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
    runTurnDaemonCli().catch((error) => {
        console.error('[turn-daemon] failed to start', error);
        process.exitCode = 1;
    });
}
