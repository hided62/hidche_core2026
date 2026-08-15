import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitestPath = path.join(packageRoot, 'node_modules', 'vitest', 'vitest.mjs');

const child = spawn(
    process.execPath,
    [
        '--expose-gc',
        vitestPath,
        'run',
        '--config',
        'vitest.config.ts',
        '--pool=threads',
        '--maxWorkers=1',
        'test/npcScenarioUnificationBenchmark.test.ts',
    ],
    {
        cwd: packageRoot,
        env: {
            ...process.env,
            NPC_UNIFICATION_BENCHMARK: '1',
        },
        stdio: 'inherit',
    }
);

child.once('error', (error) => {
    console.error('[npc-unification-timing] failed to start benchmark', error);
    process.exitCode = 1;
});

child.once('exit', (code, signal) => {
    if (signal) {
        console.error(`[npc-unification-timing] benchmark terminated by ${signal}`);
        process.exitCode = 1;
        return;
    }
    process.exitCode = code ?? 1;
});
