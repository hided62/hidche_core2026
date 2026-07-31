import { describe, expect, it, vi } from 'vitest';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';

describe('RedisAccessTokenStore.revoke', () => {
    it('deletes only a profile-scoped game access token key', async () => {
        const del = vi.fn(async () => 1);
        const store = new RedisAccessTokenStore(
            {
                get: async () => null,
                set: async () => null,
                del,
            },
            'che:default'
        );

        await expect(store.revoke('ga_current')).resolves.toBe(true);
        expect(del).toHaveBeenCalledWith('sammo:game:access:che:default:ga_current');
    });

    it('does not delete a gateway or malformed token', async () => {
        const del = vi.fn(async () => 1);
        const store = new RedisAccessTokenStore(
            {
                get: async () => null,
                set: async () => null,
                del,
            },
            'che:default'
        );

        await expect(store.revoke('gateway-token')).resolves.toBe(false);
        expect(del).not.toHaveBeenCalled();
    });
});
