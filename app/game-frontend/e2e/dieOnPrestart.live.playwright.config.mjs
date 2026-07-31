import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const frontendPort = Number(process.env.PLAYWRIGHT_FRONTEND_PORT ?? 15144);
const apiPort = Number(process.env.PLAYWRIGHT_GAME_API_PORT ?? 15145);
const basePath = `/${(process.env.PLAYWRIGHT_GAME_BASE_PATH ?? 'che').replace(/^\/+|\/+$/g, '')}`;
const profileId = process.env.PLAYWRIGHT_PROFILE_ID ?? 'die_on_prestart_live_integration';
const scenario = process.env.PLAYWRIGHT_SCENARIO ?? '2';
const expectedGameProfile = `${profileId}:${scenario}`;
const gameProfile = process.env.PLAYWRIGHT_GAME_PROFILE ?? expectedGameProfile;
const baseURL = `http://127.0.0.1:${frontendPort}${basePath}/`;
const gameApiUrl = `http://127.0.0.1:${apiPort}/trpc`;
const databaseUrl = process.env.DIE_ON_PRESTART_LIVE_DATABASE_URL ?? '';
const redisUrl = process.env.DIE_ON_PRESTART_LIVE_REDIS_URL ?? '';
const gameSecret = process.env.DIE_ON_PRESTART_LIVE_GAME_SECRET ?? '';
const databaseSchema = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') : null;

if (databaseUrl && databaseSchema !== profileId) {
    throw new Error(
        `Die-on-prestart live schema must match its profile ID: ${databaseSchema ?? '(missing)'} != ${profileId}`
    );
}
if (gameProfile !== expectedGameProfile) {
    throw new Error(
        `PLAYWRIGHT_GAME_PROFILE must match profile and scenario: ${gameProfile} != ${expectedGameProfile}`
    );
}

export default defineConfig({
    testDir: '.',
    testMatch: ['dieOnPrestartLive.spec.ts'],
    fullyParallel: false,
    workers: 1,
    timeout: 60_000,
    expect: {
        timeout: 10_000,
    },
    reporter: [['list']],
    outputDir: resolve(repositoryRoot, 'test-results/die-on-prestart-live'),
    use: {
        baseURL,
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: [
        {
            command: 'node app/game-api/dist/index.js',
            cwd: repositoryRoot,
            url: `http://127.0.0.1:${apiPort}/healthz`,
            reuseExistingServer: false,
            timeout: 120_000,
            env: {
                DATABASE_URL: databaseUrl,
                REDIS_URL: redisUrl,
                GAME_TOKEN_SECRET: gameSecret,
                GAME_API_HOST: '127.0.0.1',
                GAME_API_PORT: String(apiPort),
                PROFILE: profileId,
                SCENARIO: scenario,
                GAME_PROFILE_NAME: gameProfile,
                DAEMON_REQUEST_TIMEOUT_MS: '10000',
            },
        },
        {
            command: `VITE_APP_BASE_PATH=${basePath} VITE_GAME_API_URL=${gameApiUrl} VITE_GAME_PROFILE=${gameProfile} VITE_GATEWAY_WEB_URL=/gateway/ pnpm --filter @sammo-ts/game-frontend dev --host 127.0.0.1 --port ${frontendPort}`,
            cwd: repositoryRoot,
            url: baseURL,
            reuseExistingServer: false,
            timeout: 120_000,
        },
    ],
});
