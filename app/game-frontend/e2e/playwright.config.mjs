import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const port = Number(process.env.PLAYWRIGHT_FRONTEND_PORT ?? 15120);
const baseURL = `http://127.0.0.1:${port}/che/`;

export default defineConfig({
    testDir: '.',
    testMatch: [
        'troop.spec.ts',
        'board.spec.ts',
        'inGameInfo.spec.ts',
        'nationOffices.spec.ts',
        'nationGeneralSecret.spec.ts',
    ],
    fullyParallel: false,
    workers: 1,
    timeout: 30_000,
    expect: {
        timeout: 5_000,
    },
    reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: resolve(repositoryRoot, 'playwright-report/game-legacy') }],
    ],
    outputDir: resolve(repositoryRoot, 'test-results/game-legacy'),
    use: {
        baseURL,
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: `VITE_APP_BASE_PATH=/che VITE_GAME_API_URL=/che/api/trpc pnpm --filter @sammo-ts/game-frontend dev --host 127.0.0.1 --port ${port}`,
        cwd: repositoryRoot,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
