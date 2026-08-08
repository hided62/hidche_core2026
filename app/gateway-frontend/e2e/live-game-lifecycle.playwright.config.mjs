import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export default defineConfig({
    testDir: '.',
    testMatch: 'live-game-lifecycle.spec.ts',
    fullyParallel: false,
    workers: 1,
    timeout: 300_000,
    globalTimeout: 360_000,
    reporter: [['list']],
    outputDir: resolve(repositoryRoot, 'test-results/live-game-lifecycle'),
});
