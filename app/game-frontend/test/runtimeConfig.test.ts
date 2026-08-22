import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveGameFrontendRuntimeConfig } from '../src/config/runtimeConfig.ts';

const documentWithConfig = (value: string | null): Pick<Document, 'getElementById'> => ({
    getElementById: () => (value === null ? null : ({ textContent: value } as HTMLElement)),
});

void describe('game frontend runtime config', () => {
    void it('prefers the embedded profile wrapper config over build-time fallbacks', () => {
        const config = resolveGameFrontendRuntimeConfig(
            documentWithConfig(
                JSON.stringify({
                    version: 1,
                    profile: 'pya',
                    profileName: 'pya:default',
                    appBasePath: '/pya',
                    gameApiUrl: '/pya/api/trpc',
                    gameSseUrl: '/pya/api/events',
                    gatewayApiUrl: '/gateway/api/trpc',
                    gatewayWebUrl: '/gateway/',
                    buildCommitSha: 'a'.repeat(40),
                    assetReleaseId: `${'a'.repeat(40)}-${'b'.repeat(16)}`,
                })
            ),
            {
                VITE_APP_BASE_PATH: '/che',
                VITE_GAME_API_URL: '/che/api/trpc',
                VITE_GAME_SSE_URL: '/che/api/events',
                VITE_GAME_PROFILE: 'che',
                VITE_BUILD_COMMIT_SHA: 'c'.repeat(40),
            }
        );

        assert.equal(config.profile, 'pya');
        assert.equal(config.appBasePath, '/pya/');
        assert.equal(config.gameApiUrl, '/pya/api/trpc');
        assert.equal(config.gameSseUrl, '/pya/api/events');
        assert.equal(config.buildCommitSha, 'a'.repeat(40));
        assert.equal(config.assetReleaseId, `${'a'.repeat(40)}-${'b'.repeat(16)}`);
    });

    void it('keeps preview and local development compatible through Vite environment fallbacks', () => {
        const config = resolveGameFrontendRuntimeConfig(documentWithConfig(null), {
            VITE_APP_BASE_PATH: '/hwe',
            VITE_GAME_API_URL: '/hwe/api/trpc',
            VITE_GAME_SSE_URL: '/hwe/api/events',
            VITE_GAME_PROFILE: 'hwe',
            VITE_GATEWAY_API_URL: '/gateway/api/trpc',
            VITE_GATEWAY_WEB_URL: '/gateway/',
            VITE_BUILD_COMMIT_SHA: 'd'.repeat(40),
        });

        assert.deepEqual(config, {
            version: 1,
            profile: 'hwe',
            appBasePath: '/hwe/',
            gameApiUrl: '/hwe/api/trpc',
            gameSseUrl: '/hwe/api/events',
            gatewayApiUrl: '/gateway/api/trpc',
            gatewayWebUrl: '/gateway/',
            buildCommitSha: 'd'.repeat(40),
        });
    });

    void it('falls back safely when the embedded script is malformed', () => {
        const config = resolveGameFrontendRuntimeConfig(documentWithConfig('{'), {});

        assert.equal(config.appBasePath, '/');
        assert.equal(config.gameApiUrl, '/api/trpc');
        assert.equal(config.gameSseUrl, '/api/events');
        assert.equal(config.buildCommitSha, 'unknown');
    });
});
