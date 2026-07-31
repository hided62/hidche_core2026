import { describe, expect, it } from 'vitest';

import { buildAuctionAlias, buildAuctionAliasPool } from '../src/auction/alias.js';

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

    it('reuses the world-persisted alias pool after general creation changes RNG inputs', () => {
        const config = {
            obfuscatedNamePool: ['고정별호A', '고정별호B'],
            randGenFirstName: ['변경'],
            randGenMiddleName: ['된'],
            randGenLastName: ['이름'],
        };

        expect(buildAuctionAliasPool('new-seed', config)).toEqual(['고정별호A', '고정별호B']);
        expect(buildAuctionAlias(0, 'new-seed', config)).toBe('고정별호A');
        expect(buildAuctionAlias(1, 'new-seed', config)).toBe('고정별호B');
        expect(buildAuctionAlias(2, 'new-seed', config)).toBe('고정별호A1');
    });
});
