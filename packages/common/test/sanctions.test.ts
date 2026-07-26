import { describe, expect, it } from 'vitest';

import {
    isActiveServerRestriction,
    isGameAccessBlocked,
    isLoginBanned,
    isMessageAccessBlocked,
    isProfileFeatureBlocked,
} from '../src/auth/sanctions.js';

const NOW = new Date('2026-07-26T00:00:00.000Z');

describe('sanctions', () => {
    it('treats missing restriction expiry as indefinite and ignores expired restrictions', () => {
        expect(isActiveServerRestriction({ blockedFeatures: ['game'] }, NOW)).toBe(true);
        expect(
            isActiveServerRestriction(
                {
                    blockedFeatures: ['game'],
                    until: '2026-07-25T23:59:59.999Z',
                },
                NOW
            )
        ).toBe(false);
    });

    it('matches profile instance and base-profile feature aliases', () => {
        const sanctions = {
            serverRestrictions: {
                'che:default': { blockedFeatures: ['message'] },
                che: { blockedFeatures: ['gameplay'] },
            },
        };

        expect(isProfileFeatureBlocked(sanctions, ['che:default', 'che'], 'messages', NOW)).toBe(true);
        expect(isProfileFeatureBlocked(sanctions, ['che:default', 'che'], 'game', NOW)).toBe(true);
        expect(isProfileFeatureBlocked(sanctions, ['hwe:default', 'hwe'], 'game', NOW)).toBe(false);
    });

    it('separates login bans, gameplay suspension, and message mute', () => {
        expect(isLoginBanned({ bannedUntil: '2099-01-01T00:00:00.000Z' }, NOW)).toBe(true);
        expect(isGameAccessBlocked({ suspendedUntil: '2099-01-01T00:00:00.000Z' }, ['che'], NOW)).toBe(true);
        expect(isGameAccessBlocked({ mutedUntil: '2099-01-01T00:00:00.000Z' }, ['che'], NOW)).toBe(false);
        expect(isMessageAccessBlocked({ mutedUntil: '2099-01-01T00:00:00.000Z' }, ['che'], NOW)).toBe(true);
    });
});
