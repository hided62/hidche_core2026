import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export default defineConfig({
    testDir: '.',
    testMatch: 'general-icon-lifecycle.spec.ts',
    fullyParallel: false,
    workers: 1,
    timeout: 720_000,
    globalTimeout: 780_000,
    expect: {
        timeout: 15_000,
    },
    reporter: [['list']],
    outputDir: resolve(repositoryRoot, 'test-results/general-icon-lifecycle'),
    use: {
        baseURL: process.env.SAMMO_LIFECYCLE_BASE_URL ?? 'http://127.0.0.1:15140',
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        ignoreHTTPSErrors: true,
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
    },
    webServer: {
        command: 'node e2e/prefix-proxy.mjs',
        cwd: resolve(repositoryRoot, 'app/gateway-frontend'),
        url: 'http://127.0.0.1:15140/gateway/',
        reuseExistingServer: false,
        timeout: 30_000,
    },
});
