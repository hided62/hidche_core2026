import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const frontendPort = Number(process.env.PLAYWRIGHT_FRONTEND_PORT ?? 15161);
const apiPort = Number(process.env.PLAYWRIGHT_GAME_API_PORT ?? 15162);
const basePath = '/che';
const profileId = 'chief_command_map_live_integration';
const scenario = '2';
const gameProfile = `${profileId}:${scenario}`;
const databaseUrl = process.env.CHIEF_COMMAND_MAP_LIVE_DATABASE_URL ?? '';
const redisUrl = process.env.CHIEF_COMMAND_MAP_LIVE_REDIS_URL ?? '';
const gameSecret = process.env.CHIEF_COMMAND_MAP_LIVE_GAME_SECRET ?? '';
const imageUploadSecretFile = resolve(repositoryRoot, 'app/game-frontend/e2e/fixtures/image-upload-secret.example');

if (databaseUrl && new URL(databaseUrl).searchParams.get('schema') !== profileId) {
    throw new Error('Chief command map live database must use its dedicated schema.');
}

export default defineConfig({
    testDir: '.',
    testMatch: ['chiefCommandMapLive.spec.ts'],
    fullyParallel: false,
    workers: 1,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    reporter: [['list']],
    outputDir: resolve(repositoryRoot, 'test-results/chief-command-map-live'),
    use: {
        baseURL: `http://127.0.0.1:${frontendPort}${basePath}/`,
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
                GAME_IMAGE_UPLOAD_SECRET_FILE: imageUploadSecretFile,
                GAME_API_ROLE: 'server',
                GAME_API_HOST: '127.0.0.1',
                GAME_API_PORT: String(apiPort),
                PROFILE: profileId,
                SCENARIO: scenario,
                GAME_PROFILE_NAME: gameProfile,
                DAEMON_REQUEST_TIMEOUT_MS: '15000',
            },
        },
        {
            command: `VITE_APP_BASE_PATH=${basePath} VITE_GAME_API_URL=http://127.0.0.1:${apiPort}/trpc VITE_GAME_PROFILE=${gameProfile} VITE_GATEWAY_WEB_URL=/gateway/ pnpm --filter @sammo-ts/game-frontend build && VITE_APP_BASE_PATH=${basePath} pnpm --filter @sammo-ts/game-frontend preview --host 127.0.0.1 --port ${frontendPort}`,
            cwd: repositoryRoot,
            url: `http://127.0.0.1:${frontendPort}${basePath}/`,
            reuseExistingServer: false,
            timeout: 120_000,
        },
    ],
});
