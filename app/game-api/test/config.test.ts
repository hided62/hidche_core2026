import { describe, expect, it } from 'vitest';

import { resolveGameApiConfigFromEnv } from '../src/config.js';

describe('resolveGameApiConfigFromEnv', () => {
    it('keeps the deployment profile identity separate from the scenario id', () => {
        const config = resolveGameApiConfigFromEnv({
            PROFILE: 'hwe',
            SCENARIO: '1010',
            GAME_PROFILE_NAME: 'hwe:2',
            GAME_TOKEN_SECRET: 'test-secret',
        });

        expect(config.profile).toBe('hwe');
        expect(config.scenario).toBe('1010');
        expect(config.profileName).toBe('hwe:2');
    });

    it('falls back to the legacy profile and scenario pair', () => {
        const config = resolveGameApiConfigFromEnv({
            PROFILE: 'hwe',
            SCENARIO: '2',
            GAME_TOKEN_SECRET: 'test-secret',
        });

        expect(config.profileName).toBe('hwe:2');
    });
});
