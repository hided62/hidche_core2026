import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const port = Number(process.env.PLAYWRIGHT_GATEWAY_FRONTEND_PORT ?? 15130);

export default defineConfig({
    testDir: '.',
    testMatch: [
        'server-operations.spec.ts',
        'admin-runtime-actions.spec.ts',
        'admin-account-controls.spec.ts',
        'lobby-admin-navigation.spec.ts',
        'lobby-game-auth.spec.ts',
        'logout.spec.ts',
        'account-icon-sync.spec.ts',
        'legacy-log-html.spec.ts',
        'gateway-notice-html.spec.ts',
        'kakao-otp.spec.ts',
        'kakao-account-recovery.spec.ts',
        'public-map-tabs.spec.ts',
        'runtime-navigation.spec.ts',
    ],
    fullyParallel: false,
    workers: 1,
    timeout: 30_000,
    expect: {
        timeout: 5_000,
    },
    reporter: [['list']],
    outputDir: resolve(repositoryRoot, 'test-results/server-operations'),
    use: {
        baseURL: `http://127.0.0.1:${port}/gateway/`,
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command:
            `export VITE_APP_BASE_PATH=/gateway VITE_GATEWAY_API_URL=/gateway/api/trpc VITE_GAME_WEB_URL_TEMPLATE='/{profile}/' VITE_GAME_API_URL_TEMPLATE='/{profile}/api/trpc'; pnpm --filter @sammo-ts/gateway-frontend build && pnpm --filter @sammo-ts/gateway-frontend preview --host 127.0.0.1 --port ${port}`,
        cwd: repositoryRoot,
        url: `http://127.0.0.1:${port}/gateway/`,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
