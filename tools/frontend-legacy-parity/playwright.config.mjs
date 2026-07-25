import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
    testDir: '.',
    testMatch: 'visual-parity.spec.ts',
    fullyParallel: false,
    workers: 1,
    timeout: 30_000,
    expect: {
        timeout: 5_000,
    },
    reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: resolve(repositoryRoot, 'playwright-report/frontend-legacy') }],
    ],
    outputDir: resolve(repositoryRoot, 'test-results/frontend-legacy'),
    use: {
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        locale: 'ko-KR',
        timezoneId: 'UTC',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: [
        {
            command:
                'VITE_APP_BASE_PATH=/gateway VITE_GATEWAY_API_URL=/gateway/api/trpc VITE_GAME_API_URL_TEMPLATE=/{profile}/api/trpc VITE_GAME_ASSET_URL=/image pnpm --filter @sammo-ts/gateway-frontend dev --host 127.0.0.1 --port 15100',
            cwd: repositoryRoot,
            url: 'http://127.0.0.1:15100/gateway/',
            reuseExistingServer: false,
            timeout: 120_000,
        },
        {
            command:
                'VITE_APP_BASE_PATH=/che VITE_GAME_API_URL=/che/api/trpc VITE_GAME_ASSET_URL=/image VITE_GAME_PROFILE=che VITE_GATEWAY_WEB_URL=/gateway/ pnpm --filter @sammo-ts/game-frontend dev --host 127.0.0.1 --port 15102',
            cwd: repositoryRoot,
            url: 'http://127.0.0.1:15102/che/',
            reuseExistingServer: false,
            timeout: 120_000,
        },
    ],
});
