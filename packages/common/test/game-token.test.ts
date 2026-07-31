import { describe, expect, it } from 'vitest';

import {
    decryptGameSessionToken,
    encryptGameSessionToken,
    parseGameSessionTokenPayload,
    type GameSessionTokenPayload,
} from '../src/auth/gameToken.js';

const buildPayload = (): GameSessionTokenPayload => ({
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-07-31T09:00:00.000Z',
    expiresAt: '2026-07-31T09:10:00.000Z',
    sessionId: 'session-1',
    user: {
        id: 'user-1',
        username: 'tester',
        displayName: '테스트',
        roles: ['user'],
        picture: 'account-icon.png',
        imageServer: 1,
        iconUpdatedAt: '2026-07-31T08:59:00.000Z',
    },
    sanctions: {},
});

describe('game session token account icon revision', () => {
    it('round-trips the canonical account icon revision', () => {
        const payload = buildPayload();
        const token = encryptGameSessionToken(payload, 'test-only-secret');

        expect(decryptGameSessionToken(token, 'test-only-secret')).toEqual(payload);
    });

    it.each([1, {}, '2026-07-31', '2026-07-31T08:59:00Z', 'not-a-date'])(
        'rejects a non-canonical icon revision: %j',
        (iconUpdatedAt) => {
            const payload = buildPayload() as unknown as {
                user: { iconUpdatedAt: unknown };
            };
            payload.user.iconUpdatedAt = iconUpdatedAt;

            expect(parseGameSessionTokenPayload(payload)).toBeNull();
        }
    );
});
