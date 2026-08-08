import { describe, expect, it } from 'vitest';

import { buildPm2StartOptions } from '../src/orchestrator/pm2ProcessManager.js';

describe('buildPm2StartOptions', () => {
    it('enforces bounded restart policy and strips inherited PM2 identity at the PM2 boundary', () => {
        const options = buildPm2StartOptions({
            name: 'sammo:che:2:game-api',
            script: '/srv/sammo/app/game-api/dist/index.js',
            cwd: '/srv/sammo/app/game-api',
            env: {
                DATABASE_URL: 'postgresql://integration.invalid/sammo',
                GAME_API_ROLE: 'server',
                args: 'daemon',
                pm_id: '2',
                pm_exec_path: '/srv/sammo/app/gateway-api/dist/index.js',
                name: 'sammo:gateway-orchestrator',
                NODE_APP_INSTANCE: '2',
            },
        });

        expect(options).toMatchObject({
            name: 'sammo:che:2:game-api',
            autorestart: true,
            max_restarts: 5,
            min_uptime: 10_000,
            restart_delay: 2_000,
            kill_timeout: 15_000,
            env: {
                DATABASE_URL: 'postgresql://integration.invalid/sammo',
                GAME_API_ROLE: 'server',
            },
        });
        expect(options.env).not.toHaveProperty('pm_id');
        expect(options.env).not.toHaveProperty('args');
        expect(options.env).not.toHaveProperty('pm_exec_path');
        expect(options.env).not.toHaveProperty('name');
        expect(options.env).not.toHaveProperty('NODE_APP_INSTANCE');
        expect(options.env).toHaveProperty('GAME_API_ROLE', 'server');
    });

    it('keeps explicit child arguments when a PM2 parent exposes its own args in the environment', () => {
        const options = buildPm2StartOptions({
            name: 'sammo:gateway-frontend',
            script: '/srv/sammo/app/gateway-frontend/node_modules/vite/bin/vite.js',
            cwd: '/srv/sammo/app/gateway-frontend',
            args: ['preview', '--host', '0.0.0.0', '--port', '15000'],
            env: {
                args: 'daemon',
                name: 'sammo:release-controller',
                pm_id: '3',
            },
        });

        expect(options.args).toEqual(['preview', '--host', '0.0.0.0', '--port', '15000']);
        expect(options.env).not.toHaveProperty('args');
    });
});
