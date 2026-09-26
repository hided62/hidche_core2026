import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const schema = new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema');
if (!schema || !/^[a-z0-9_]+_npc_audit_lifecycle$/.test(schema)) throw new Error('Dedicated lifecycle DB required');
const frontendPort = Number(process.env.NPC_AUDIT_FRONTEND_PORT ?? 15301);
const apiPort = Number(process.env.NPC_AUDIT_API_PORT ?? 15302);
const frontendEnv = `VITE_APP_BASE_PATH=/che VITE_GAME_PROFILE=che:default VITE_GAME_API_URL=http://127.0.0.1:${apiPort}/che/api/trpc`;
export default defineConfig({
    testDir: '.',
    testMatch: 'play-audit-npc.spec.ts',
    workers: 1,
    timeout: 60000,
    outputDir: resolve(root, 'test-results/npc-audit-browser'),
    use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${frontendPort}/che/`,
        locale: 'ko-KR',
        timezoneId: 'UTC',
        deviceScaleFactor: 1,
        trace: 'off',
    },
    webServer: [
        {
            command: `GAME_API_ROLE=server GAME_API_HOST=127.0.0.1 GAME_API_PORT=${apiPort} GAME_TRPC_PATH=/che/api/trpc GAME_API_EVENTS_PATH=/che/api/events PROFILE=${schema} SCENARIO=default GAME_PROFILE_NAME=che:default node app/game-api/dist/index.js`,
            cwd: root,
            url: `http://127.0.0.1:${apiPort}/che/api/trpc/health.ping`,
            timeout: 120000,
        },
        {
            command: `${frontendEnv} pnpm --filter @sammo-ts/game-frontend build && ${frontendEnv} pnpm --filter @sammo-ts/game-frontend preview --host 127.0.0.1 --port ${frontendPort}`,
            cwd: root,
            url: `http://127.0.0.1:${frontendPort}/che/`,
            timeout: 120000,
        },
    ],
});
