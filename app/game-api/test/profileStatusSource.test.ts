import { afterEach, describe, expect, it, vi } from 'vitest';

import { GatewayHttpProfileStatusSource } from '../src/auth/profileStatusSource.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('GatewayHttpProfileStatusSource', () => {
    it('uses an encoded path and a purpose-derived credential', async () => {
        const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(
            async () =>
                new Response(JSON.stringify({ profileName: 'che:default/한글', status: 'RUNNING' }), { status: 200 })
        );
        vi.stubGlobal('fetch', fetchMock);

        const source = new GatewayHttpProfileStatusSource('http://gateway.internal/', 'root-secret');
        await expect(source.get('che:default/한글')).resolves.toBe('RUNNING');

        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe('http://gateway.internal/internal/profile-status/che%3Adefault%2F%ED%95%9C%EA%B8%80');
        expect(init?.headers).toMatchObject({
            'x-sammo-internal-token': expect.not.stringContaining('root-secret'),
        });
    });

    it('returns null only for a missing profile and rejects malformed status values', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(null, { status: 404 }))
        );
        await expect(new GatewayHttpProfileStatusSource('http://gateway', 'secret').get('missing')).resolves.toBeNull();

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ profileName: 'che', status: 'UNKNOWN' }), { status: 200 }))
        );
        await expect(new GatewayHttpProfileStatusSource('http://gateway', 'secret').get('che')).rejects.toThrow(
            'invalid'
        );
    });
});
