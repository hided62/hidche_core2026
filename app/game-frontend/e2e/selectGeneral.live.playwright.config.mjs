import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const port = Number(process.env.PLAYWRIGHT_FRONTEND_PORT ?? 15124);
const basePath = `/${(process.env.PLAYWRIGHT_GAME_BASE_PATH ?? 'hwe').replace(/^\/+|\/+$/g, '')}`;
const gameProfile = process.env.PLAYWRIGHT_GAME_PROFILE ?? 'hwe:903';
const baseURL = `http://127.0.0.1:${port}${basePath}/`;
const gameApiUrl = process.env.PLAYWRIGHT_GAME_API_URL ?? 'http://127.0.0.1:15125/trpc';

export default defineConfig({
    testDir: '.',
    testMatch: ['selectGeneralLive.spec.ts'],
    fullyParallel: false,
    workers: 1,
    timeout: 60_000,
    expect: {
        timeout: 10_000,
    },
    reporter: [['list']],
    outputDir: resolve(repositoryRoot, 'test-results/select-pool-live'),
    use: {
        baseURL,
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: `VITE_APP_BASE_PATH=${basePath} VITE_GAME_API_URL=${gameApiUrl} VITE_GAME_PROFILE=${gameProfile} VITE_GATEWAY_WEB_URL=/gateway/ pnpm --filter @sammo-ts/game-frontend dev --host 127.0.0.1 --port ${port}`,
        cwd: repositoryRoot,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
