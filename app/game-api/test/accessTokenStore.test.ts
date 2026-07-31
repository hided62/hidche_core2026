import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';

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

describe('RedisAccessTokenStore.issueFromGateway', () => {
    const payload = {
        sessionId: 'gateway-session-1',
        profile: 'che:default',
        issuedAt: '2099-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T01:00:00.000Z',
        user: { id: 'user-1', username: 'tester' },
        roles: [],
        sanctions: [],
    } as unknown as GameSessionTokenPayload;

    it('issues the access key and consumes the gateway token in one Redis evaluation', async () => {
        const evalCommand = vi.fn(async (_script: string, _options: { keys: string[]; arguments: string[] }) => 1);
        const store = new RedisAccessTokenStore(
            {
                get: async () => null,
                set: async () => null,
                eval: evalCommand,
            },
            'che:default'
        );

        const issued = await store.issueFromGateway(payload);

        expect(issued).toMatchObject({ expiresAt: payload.expiresAt });
        expect(issued && issued !== 'ALREADY_USED' ? issued.accessToken : '').toMatch(/^ga_/);
        expect(evalCommand).toHaveBeenCalledTimes(1);
        expect(evalCommand.mock.calls[0]?.[1].keys[0]).toBe('sammo:game:gateway-used:che:default:gateway-session-1');
        expect(evalCommand.mock.calls[0]?.[1].keys[1]).toBe(
            `sammo:game:access:che:default:${issued && issued !== 'ALREADY_USED' ? issued.accessToken : ''}`
        );
    });

    it('can retry after an atomic Redis evaluation fails before commit', async () => {
        const keys = new Set<string>();
        let attempts = 0;
        const evalCommand = vi.fn(async (_script: string, options: { keys: string[] }) => {
            attempts += 1;
            if (attempts === 1) {
                throw new Error('injected Redis failure');
            }
            if (keys.has(options.keys[0] ?? '')) {
                return 0;
            }
            keys.add(options.keys[0] ?? '');
            keys.add(options.keys[1] ?? '');
            return 1;
        });
        const store = new RedisAccessTokenStore(
            {
                get: async () => null,
                set: async () => null,
                eval: evalCommand,
            },
            'che:default'
        );

        await expect(store.issueFromGateway(payload)).rejects.toThrow('injected Redis failure');
        expect(keys.size).toBe(0);
        await expect(store.issueFromGateway(payload)).resolves.toMatchObject({ expiresAt: payload.expiresAt });
        expect([...keys].filter((key) => key.includes(':access:'))).toHaveLength(1);
        expect([...keys].filter((key) => key.includes(':gateway-used:'))).toHaveLength(1);
        await expect(store.issueFromGateway(payload)).resolves.toBe('ALREADY_USED');
    });
});
