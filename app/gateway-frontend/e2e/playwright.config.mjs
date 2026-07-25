import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export default defineConfig({
    testDir: '.',
    testMatch: ['server-operations.spec.ts', 'lobby-admin-navigation.spec.ts'],
    fullyParallel: false,
    workers: 1,
    timeout: 30_000,
    expect: {
        timeout: 5_000,
    },
    reporter: [['list']],
    outputDir: resolve(repositoryRoot, 'test-results/server-operations'),
    use: {
        baseURL: 'http://127.0.0.1:15130/gateway/',
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command:
            'VITE_APP_BASE_PATH=/gateway pnpm --filter @sammo-ts/gateway-frontend preview --host 127.0.0.1 --port 15130',
        cwd: repositoryRoot,
        url: 'http://127.0.0.1:15130/gateway/',
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
