import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const frontendUrl = process.env.CHIEF_CENTER_LIVE_FRONTEND_URL ?? 'http://127.0.0.1:15160/hwe/';

export default defineConfig({
    testDir: '.',
    testMatch: ['chiefCenterLive.spec.ts'],
    fullyParallel: false,
    workers: 1,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    reporter: [['list']],
    outputDir: resolve(repositoryRoot, 'test-results/chief-center-live'),
    use: {
        baseURL: frontendUrl,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
});
