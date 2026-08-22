import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadConfigFromFile } from 'vite';
import { mergeViteEnv } from '../src/config/viteEnv.ts';

void describe('game frontend Vite config', () => {
    void it('prefers managed runtime values over values loaded from env files', () => {
        const env = mergeViteEnv(
            { VITE_APP_BASE_PATH: '/gateway', VITE_GAME_API_URL: '/gateway/api/trpc' },
            { VITE_APP_BASE_PATH: '/hwe', VITE_GAME_API_URL: '/hwe/api/trpc' }
        );

        assert.equal(env.VITE_APP_BASE_PATH, '/hwe');
        assert.equal(env.VITE_GAME_API_URL, '/hwe/api/trpc');
    });

    void it('keeps production source maps enabled', async () => {
        const configPath = path.resolve(import.meta.dirname, '../vite.config.ts');
        const loaded = await loadConfigFromFile(
            { command: 'build', mode: 'production' },
            configPath,
            path.dirname(configPath),
            undefined,
            undefined,
            'runner'
        );

        assert.equal(loaded?.config.build?.sourcemap, true);
    });

    void it('uses the deployment-pinned full commit SHA as the displayed build version', async () => {
        const commitSha = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
        const previousCommitSha = process.env.VITE_BUILD_COMMIT_SHA;
        process.env.VITE_BUILD_COMMIT_SHA = commitSha;
        try {
            const configPath = path.resolve(import.meta.dirname, '../vite.config.ts');
            const loaded = await loadConfigFromFile(
                { command: 'build', mode: 'production' },
                configPath,
                path.dirname(configPath),
                undefined,
                undefined,
                'runner'
            );

            assert.equal(
                loaded?.config.define?.['import.meta.env.VITE_BUILD_COMMIT_SHA'],
                JSON.stringify(commitSha.toLowerCase())
            );
            assert.equal(
                loaded?.config.plugins?.some(
                    (plugin) =>
                        plugin !== null &&
                        typeof plugin === 'object' &&
                        !Array.isArray(plugin) &&
                        'name' in plugin &&
                        plugin.name === 'sammo-deployment-version'
                ),
                true
            );
        } finally {
            if (previousCommitSha === undefined) delete process.env.VITE_BUILD_COMMIT_SHA;
            else process.env.VITE_BUILD_COMMIT_SHA = previousCommitSha;
        }
    });
});
