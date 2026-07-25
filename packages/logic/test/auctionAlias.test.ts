import { describe, expect, it } from 'vitest';

import { buildAuctionAlias } from '../src/auction/alias.js';

describe('buildAuctionAlias', () => {
    it('returns a stable alias for the same world seed and general id', () => {
        const first = buildAuctionAlias(17, 'legacy-compatible-seed');
        const second = buildAuctionAlias(17, 'legacy-compatible-seed');

        expect(second).toBe(first);
        expect(first.length).toBeGreaterThan(1);
    });

    it('uses scenario-specific name pools without exposing a general name', () => {
        const config = {
            randGenFirstName: ['청'],
            randGenMiddleName: ['운'],
            randGenLastName: ['객', '상'],
        };

        expect(buildAuctionAlias(0, 'seed', config)).toMatch(/^청운(객|상)$/);
        expect(buildAuctionAlias(1, 'seed', config)).toMatch(/^청운(객|상)$/);
        expect(buildAuctionAlias(2, 'seed', config)).toMatch(/^청운(객|상)1$/);
    });
});
