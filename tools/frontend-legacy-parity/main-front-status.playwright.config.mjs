import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const frontendPort = Number(process.env.FRONTEND_PARITY_LIVE_FRONTEND_PORT ?? 15112);
const apiPort = Number(process.env.FRONTEND_PARITY_LIVE_API_PORT ?? 15113);

export default defineConfig({
    testDir: '.',
    testMatch: ['main-front-status.spec.ts'],
    fullyParallel: false,
    workers: 1,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: [['list']],
    outputDir: process.env.SAMMO_TEST_OUTPUT_DIR ?? resolve(repositoryRoot, 'test-results/main-front-status-live'),
    use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${frontendPort}/che/`,
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        timezoneId: 'UTC',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: [
        {
            command:
                `GAME_API_HOST=127.0.0.1 GAME_API_PORT=${apiPort} ` +
                'GAME_TRPC_PATH=/che/api/trpc GAME_API_EVENTS_PATH=/che/api/events ' +
                'PROFILE=che SCENARIO=default GAME_PROFILE_NAME=che:default node app/game-api/dist/index.js',
            cwd: repositoryRoot,
            url: `http://127.0.0.1:${apiPort}/che/api/trpc/health.ping?input=%7B%22json%22%3Anull%7D`,
            reuseExistingServer: false,
            timeout: 120_000,
        },
        {
            command:
                `VITE_APP_BASE_PATH=/che VITE_GAME_API_URL=http://127.0.0.1:${apiPort}/che/api/trpc ` +
                `VITE_GAME_SSE_URL=http://127.0.0.1:${apiPort}/che/api/events ` +
                'pnpm --filter @sammo-ts/game-frontend build && ' +
                `VITE_APP_BASE_PATH=/che VITE_GAME_API_URL=http://127.0.0.1:${apiPort}/che/api/trpc ` +
                `VITE_GAME_SSE_URL=http://127.0.0.1:${apiPort}/che/api/events ` +
                `pnpm --filter @sammo-ts/game-frontend preview --host 127.0.0.1 --port ${frontendPort}`,
            cwd: repositoryRoot,
            url: `http://127.0.0.1:${frontendPort}/che/`,
            reuseExistingServer: false,
            timeout: 120_000,
        },
    ],
});
