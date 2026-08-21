import { describe, expect, it } from 'vitest';

import {
    resolveLegacyCompatibleUniqueConfig,
    resolveLegacyPurchasableItemKeys,
} from '../src/rewards/legacyUniqueItemPool.js';

describe('legacy-compatible unique item pool', () => {
    it.each([undefined, {}, '{}'] as const)('restores the Ref default pool when allItems is %j', async (allItems) => {
        const config = await resolveLegacyCompatibleUniqueConfig(allItems === undefined ? {} : { allItems });

        expect(Object.keys(config.allItems)).toEqual(['horse', 'weapon', 'book', 'item']);
        expect(config.allItems.weapon?.che_무기_12_칠성검).toBe(2);
        expect(config.allItems.item?.che_의술_청낭서).toBe(1);
        expect(config.allItems.weapon?.che_무기_01_단도).toBeUndefined();
    });

    it('preserves an explicit scenario pool, including its counts', async () => {
        const config = await resolveLegacyCompatibleUniqueConfig({
            allItems: {
                weapon: {
                    che_무기_12_칠성검: 7,
                },
            },
        });

        expect(config.allItems).toEqual({
            weapon: {
                che_무기_12_칠성검: 7,
            },
        });
    });

    it.each([undefined, {}, '{}'] as const)('restores the Ref default shop items when allItems is %j', (allItems) => {
        const keys = resolveLegacyPurchasableItemKeys(allItems === undefined ? {} : { allItems });

        expect(keys.size).toBe(24);
        expect(keys.has('che_명마_01_노기')).toBe(true);
        expect(keys.has('che_치료_환약')).toBe(true);
        expect(keys.has('event_전투특기_격노')).toBe(false);
    });

    it('uses only non-limited entries from an explicit scenario shop pool', () => {
        const keys = resolveLegacyPurchasableItemKeys({
            allItems: {
                weapon: {
                    che_무기_01_단도: 0,
                    che_무기_12_칠성검: 2,
                },
                item: {
                    event_전투특기_격노: 0,
                },
            },
        });

        expect([...keys]).toEqual(['che_무기_01_단도', 'event_전투특기_격노']);
    });
});
