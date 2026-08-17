import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const gamePort = process.env.FRONTEND_PARITY_GAME_PORT ?? '15126';
const gameOrigin = `http://127.0.0.1:${gamePort}`;
const frontendEnv =
    'VITE_APP_BASE_PATH=/che VITE_GAME_API_URL=/che/api/trpc ' +
    'VITE_IMAGE_PUBLIC_URL=/image VITE_GAME_ASSET_URL=/image ' +
    'VITE_GAME_PROFILE=che VITE_GATEWAY_WEB_URL=/gateway/';

export default defineConfig({
    testDir: '.',
    testMatch: ['dynasty-parity.spec.ts', 'map-trend.spec.ts'],
    fullyParallel: false,
    workers: 1,
    timeout: 30_000,
    expect: { timeout: 5_000 },
    reporter: [['list']],
    outputDir: process.env.SAMMO_TEST_OUTPUT_DIR ?? resolve(repositoryRoot, 'test-results/game-font'),
    use: {
        ...devices['Desktop Chrome'],
        baseURL: `${gameOrigin}/che/`,
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        timezoneId: 'UTC',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: `${frontendEnv} pnpm --filter @sammo-ts/game-frontend build && ${frontendEnv} pnpm --filter @sammo-ts/game-frontend preview --host 127.0.0.1 --port ${gamePort}`,
        cwd: repositoryRoot,
        url: `${gameOrigin}/che/`,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
