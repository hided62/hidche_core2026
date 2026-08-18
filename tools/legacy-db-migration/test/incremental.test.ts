import { describe, expect, it } from 'vitest';

import {
    fingerprintMariaConnection,
    requireIncrementalCheckpoint,
    validateSourceIdentity,
} from '../src/incremental.js';

describe('legacy incremental source identity', () => {
    it('excludes passwords while binding host, database, user, and non-secret options', () => {
        const first = fingerprintMariaConnection('mariadb://reader:first@db.internal:3307/root_dump?ssl=true');
        const rotated = fingerprintMariaConnection('mariadb://reader:rotated@db.internal:3307/root_dump?ssl=true');
        const otherDatabase = fingerprintMariaConnection('mariadb://reader:rotated@db.internal:3307/che_dump?ssl=true');

        expect(first).toBe(rotated);
        expect(first).not.toBe(otherDatabase);
    });

    it('rejects missing, mismatched, and malformed checkpoint identities', () => {
        const source = { key: 'cutover:che', fingerprint: 'a'.repeat(64) };
        expect(() => requireIncrementalCheckpoint(null, source, 'hall')).toThrow('completed full checkpoint');
        expect(() =>
            requireIncrementalCheckpoint({ sourceFingerprint: 'b'.repeat(64), lastLegacyId: 1n }, source, 'hall')
        ).toThrow('fingerprint changed');
        expect(() => validateSourceIdentity({ key: '../unsafe', fingerprint: 'a'.repeat(64) })).toThrow(
            'safe characters'
        );
    });
});
