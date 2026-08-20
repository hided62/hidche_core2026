import { describe, expect, it } from 'vitest';

import { resolveLegacyCompatibleUniqueConfig } from '../src/rewards/legacyUniqueItemPool.js';

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
});
