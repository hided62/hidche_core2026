import { describe, expect, it } from 'vitest';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';

import {
    consumeRealtimeAccessGrantHeader,
    createRealtimeAccessGrant,
    REALTIME_ACCESS_GRANT_TTL_MS,
    registerRealtimeAccessGrant,
    verifyRealtimeAccessGrant,
    verifyRealtimeAccessGrantHeader,
} from '../src/auth/realtimeAccessGrant.js';

const secret = 'realtime-access-grant-test-secret-with-enough-entropy';
const now = new Date('2026-08-17T10:00:00.000Z');
const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'hwe:default',
    issuedAt: '2026-08-17T09:00:00.000Z',
    expiresAt: '2026-08-17T11:00:00.000Z',
    sessionId: 'session-private-value',
    user: {
        id: 'user-private-value',
        username: 'grant-user',
        displayName: '갱신 사용자',
        roles: ['user'],
    },
    sanctions: {},
};

describe('realtime access grant', () => {
    it('binds an opaque short-lived grant to the authenticated session and profile', () => {
        const grant = createRealtimeAccessGrant(auth, 'hwe:default', secret, now);

        expect(grant).not.toContain(auth.user.id);
        expect(grant).not.toContain(auth.sessionId);
        expect(grant).not.toContain('hwe:default');
        expect(verifyRealtimeAccessGrant(grant, auth, 'hwe:default', secret, now)).toBe(true);
        expect(verifyRealtimeAccessGrantHeader([grant], auth, 'hwe:default', secret, now)).toBe(true);
        expect(
            verifyRealtimeAccessGrant(grant, { ...auth, sessionId: 'another-session' }, 'hwe:default', secret, now)
        ).toBe(false);
        expect(verifyRealtimeAccessGrant(grant, auth, 'che:default', secret, now)).toBe(false);
    });

    it('rejects expired, tampered, unauthenticated, and malformed grants', () => {
        const grant = createRealtimeAccessGrant(auth, 'hwe:default', secret, now);
        const atExpiry = new Date(now.getTime() + REALTIME_ACCESS_GRANT_TTL_MS);
        const afterExpiry = new Date(now.getTime() + REALTIME_ACCESS_GRANT_TTL_MS + 1);
        const grantParts = grant.split('.');
        const encryptedPart = grantParts[1] ?? '';
        grantParts[1] = `${encryptedPart.startsWith('A') ? 'B' : 'A'}${encryptedPart.slice(1)}`;
        const tampered = grantParts.join('.');

        expect(verifyRealtimeAccessGrant(grant, auth, 'hwe:default', secret, atExpiry)).toBe(false);
        expect(verifyRealtimeAccessGrant(grant, auth, 'hwe:default', secret, afterExpiry)).toBe(false);
        expect(verifyRealtimeAccessGrant(tampered, auth, 'hwe:default', secret, now)).toBe(false);
        expect(verifyRealtimeAccessGrant(grant, null, 'hwe:default', secret, now)).toBe(false);
        expect(verifyRealtimeAccessGrant('not-a-grant', auth, 'hwe:default', secret, now)).toBe(false);
    });

    it('registers a grant in Redis and consumes it exactly once', async () => {
        const values = new Set<string>();
        const redis = {
            set: async (key: string) => {
                if (values.has(key)) return null;
                values.add(key);
                return 'OK';
            },
            eval: async (_script: string, options: { keys: string[] }) =>
                values.delete(options.keys[0] ?? '') ? 1 : 0,
        };
        const grant = createRealtimeAccessGrant(auth, 'hwe:default', secret, now);

        await expect(registerRealtimeAccessGrant(redis, grant, 'hwe:default')).resolves.toBe(true);
        await expect(consumeRealtimeAccessGrantHeader(redis, grant, auth, 'hwe:default', secret, now)).resolves.toBe(
            true
        );
        await expect(consumeRealtimeAccessGrantHeader(redis, grant, auth, 'hwe:default', secret, now)).resolves.toBe(
            false
        );
    });
});
