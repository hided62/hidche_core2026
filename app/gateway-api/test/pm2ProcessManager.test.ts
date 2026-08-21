import { describe, expect, it, vi } from 'vitest';

import {
    buildPm2StartOptions,
    Pm2ProcessManager,
    type Pm2Client,
} from '../src/orchestrator/pm2ProcessManager.js';

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

describe('Pm2ProcessManager session recovery', () => {
    it('serializes concurrent PM2 sessions so one disconnect cannot interrupt another request', async () => {
        const events: string[] = [];
        let listCall = 0;
        let releaseFirstList: (() => void) | undefined;
        const pm2 = {
            connect(callback: Parameters<Pm2Client['connect']>[0]) {
                events.push('connect');
                callback();
            },
            disconnect() {
                events.push('disconnect');
            },
            list(callback: Parameters<Pm2Client['list']>[0]) {
                listCall += 1;
                const currentCall = listCall;
                events.push(`list:${currentCall}`);
                if (currentCall === 1) {
                    releaseFirstList = () => callback(null, []);
                    return;
                }
                callback(null, []);
            },
            start() {
                throw new Error('unused');
            },
            stop() {
                throw new Error('unused');
            },
            delete() {
                throw new Error('unused');
            },
        } satisfies Pm2Client;
        const manager = new Pm2ProcessManager({ loadPm2: () => pm2 });

        const first = manager.list();
        const second = manager.list();
        await vi.waitFor(() => expect(events).toEqual(['connect', 'list:1']));

        releaseFirstList?.();
        await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
        expect(events).toEqual(['connect', 'list:1', 'disconnect', 'connect', 'list:2', 'disconnect']);
    });

    it('times out a lost PM2 callback and lets the next queued session proceed', async () => {
        let listCall = 0;
        const pm2 = {
            connect(callback: Parameters<Pm2Client['connect']>[0]) {
                callback();
            },
            disconnect() {},
            list(callback: Parameters<Pm2Client['list']>[0]) {
                listCall += 1;
                if (listCall === 1) {
                    return;
                }
                callback(null, []);
            },
            start() {
                throw new Error('unused');
            },
            stop() {
                throw new Error('unused');
            },
            delete() {
                throw new Error('unused');
            },
        } satisfies Pm2Client;
        const manager = new Pm2ProcessManager({
            loadPm2: () => pm2,
            listTimeoutMs: 10,
        });

        await expect(manager.list()).rejects.toThrow('PM2 list timed out after 10ms.');
        await expect(manager.list()).resolves.toEqual([]);
    });

    it('disconnects a timed-out PM2 connection before releasing the serialized session', async () => {
        let connectCall = 0;
        let disconnectCall = 0;
        const pm2 = {
            connect(callback: Parameters<Pm2Client['connect']>[0]) {
                connectCall += 1;
                if (connectCall > 1) {
                    callback();
                }
            },
            disconnect() {
                disconnectCall += 1;
            },
            list(callback: Parameters<Pm2Client['list']>[0]) {
                callback(null, []);
            },
            start() {
                throw new Error('unused');
            },
            stop() {
                throw new Error('unused');
            },
            delete() {
                throw new Error('unused');
            },
        } satisfies Pm2Client;
        const manager = new Pm2ProcessManager({
            loadPm2: () => pm2,
            connectTimeoutMs: 10,
        });

        await expect(manager.list()).rejects.toThrow('PM2 connect timed out after 10ms.');
        expect(disconnectCall).toBe(1);
        await expect(manager.list()).resolves.toEqual([]);
        expect(disconnectCall).toBe(2);
    });
});
