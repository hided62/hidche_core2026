import { describe, expect, it } from 'vitest';
import { buildGameReadModelDomainRevisionKey } from '@sammo-ts/common';

import { buildRevisionedBaseMapCacheKey } from '../src/maps/worldMap.js';
import type { GameApiContext } from '../src/context.js';

describe('world map revision cache', () => {
    it('selects a new shared base-map key after a committed world revision', async () => {
        const reads: Array<[string, string]> = [];
        const ctx = {
            profile: { id: 'hwe', name: 'hwe', scenario: 'scenario_2400' },
            redis: {
                hGet: async (key: string, field: string) => {
                    reads.push([key, field]);
                    return '12';
                },
            },
        } as unknown as GameApiContext;

        await expect(buildRevisionedBaseMapCacheKey(ctx)).resolves.toBe(
            'sammo:map:base:hwe:scenario_2400:r12'
        );
        expect(reads).toEqual([[buildGameReadModelDomainRevisionKey('hwe'), 'world']]);
    });

    it('falls back to revision zero when Redis is temporarily unavailable', async () => {
        const ctx = {
            profile: { id: 'hwe', name: 'hwe', scenario: 'scenario_2400' },
            redis: { hGet: async () => Promise.reject(new Error('redis unavailable')) },
        } as unknown as GameApiContext;

        await expect(buildRevisionedBaseMapCacheKey(ctx)).resolves.toBe(
            'sammo:map:base:hwe:scenario_2400:r0'
        );
    });
});
