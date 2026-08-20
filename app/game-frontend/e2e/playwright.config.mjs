import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const port = Number(process.env.PLAYWRIGHT_FRONTEND_PORT ?? 15120);
const basePath = `/${(process.env.PLAYWRIGHT_GAME_BASE_PATH ?? 'che').replace(/^\/+|\/+$/g, '')}`;
const gameProfile = process.env.PLAYWRIGHT_GAME_PROFILE ?? 'che:default';
const baseURL = `http://127.0.0.1:${port}${basePath}/`;
const gameApiUrl = process.env.PLAYWRIGHT_GAME_API_URL ?? `${basePath}/api/trpc`;
const gatewayWebUrl = process.env.PLAYWRIGHT_GATEWAY_WEB_URL ?? '/gateway/';
const useProductionBundle = process.env.PLAYWRIGHT_FRONTEND_MODE === 'production';
const frontendEnv =
    `VITE_APP_BASE_PATH=${basePath} VITE_GAME_API_URL=${gameApiUrl} ` +
    `VITE_GAME_PROFILE=${gameProfile} VITE_GATEWAY_WEB_URL=${gatewayWebUrl} ` +
    'VITE_GATEWAY_API_URL=/gateway/api/trpc';

export default defineConfig({
    testDir: '.',
    testMatch: [
        'troop.spec.ts',
        'board.spec.ts',
        'inGameInfo.spec.ts',
        'nationCityOfficeIntegration.spec.ts',
        'inGameMenus.spec.ts',
        'nationOffices.spec.ts',
        'diplomacy.spec.ts',
        'legacyLogHtml.spec.ts',
        'directoryLists.spec.ts',
        'pastPlays.spec.ts',
        'legacyArchiveViews.spec.ts',
        'nationGeneralSecret.spec.ts',
        'npcPolicy.spec.ts',
        'auction.spec.ts',
        'tournamentBracket.spec.ts',
        'battleSimulator.spec.ts',
        'battleSimulatorRef.spec.ts',
        'commandArguments.spec.ts',
        'commandArgumentsLive.spec.ts',
        'mainNavigation.spec.ts',
        'session-auth.spec.ts',
        'npcPossession.spec.ts',
        'joinLayout.spec.ts',
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
        command: useProductionBundle
            ? `${frontendEnv} pnpm --filter @sammo-ts/game-frontend build && ${frontendEnv} pnpm --filter @sammo-ts/game-frontend preview --host 127.0.0.1 --port ${port}`
            : `${frontendEnv} pnpm --filter @sammo-ts/game-frontend dev --host 127.0.0.1 --port ${port}`,
        cwd: repositoryRoot,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
