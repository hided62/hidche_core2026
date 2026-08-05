import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeViteEnv } from '../vite.config.ts';

void describe('game frontend Vite config', () => {
    void it('prefers managed runtime values over values loaded from env files', () => {
        const env = mergeViteEnv(
            { VITE_APP_BASE_PATH: '/gateway', VITE_GAME_API_URL: '/gateway/api/trpc' },
            { VITE_APP_BASE_PATH: '/hwe', VITE_GAME_API_URL: '/hwe/api/trpc' }
        );

        assert.equal(env.VITE_APP_BASE_PATH, '/hwe');
        assert.equal(env.VITE_GAME_API_URL, '/hwe/api/trpc');
    });
});
