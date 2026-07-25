import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export default defineConfig({
    testDir: '.',
    testMatch: 'troop.spec.ts',
    fullyParallel: false,
    workers: 1,
    timeout: 30_000,
    expect: {
        timeout: 5_000,
    },
    reporter: [['list'], ['html', { open: 'never', outputFolder: resolve(repositoryRoot, 'playwright-report') }]],
    outputDir: resolve(repositoryRoot, 'test-results/troop'),
    use: {
        baseURL: 'http://127.0.0.1:15120/che/',
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command:
            'VITE_APP_BASE_PATH=/che VITE_GAME_API_URL=/che/api/trpc pnpm --filter @sammo-ts/game-frontend dev --host 127.0.0.1 --port 15120',
        cwd: repositoryRoot,
        url: 'http://127.0.0.1:15120/che/',
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
