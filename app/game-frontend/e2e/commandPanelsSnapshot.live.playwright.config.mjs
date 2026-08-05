import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const frontendUrl = process.env.COMMAND_PANEL_LIVE_FRONTEND_URL ?? 'http://127.0.0.1:15173/hwe/';

export default defineConfig({
    testDir: '.',
    testMatch: ['commandPanelsSnapshotLive.spec.ts'],
    workers: 1,
    timeout: 120_000,
    expect: { timeout: 15_000 },
    reporter: [['list']],
    outputDir: resolve(repositoryRoot, 'test-results/command-panels-snapshot-live'),
    use: {
        baseURL: frontendUrl,
        ...devices['Desktop Chrome'],
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        colorScheme: 'dark',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
});
