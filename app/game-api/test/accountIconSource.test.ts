import { afterEach, describe, expect, it, vi } from 'vitest';

import { GatewayHttpAccountIconSource } from '../src/auth/accountIconSource.js';

const projection = {
    revision: '2026-07-31T09:00:00.001Z',
    picture: 'latest.png',
    imageServer: 1,
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('GatewayHttpAccountIconSource', () => {
    it('uses an encoded path and a purpose-derived credential', async () => {
        const fetchMock = vi.fn(
            async (_input: string | URL | Request, _init?: RequestInit) =>
                new Response(JSON.stringify(projection), { status: 200 })
        );
        vi.stubGlobal('fetch', fetchMock);

        const source = new GatewayHttpAccountIconSource('http://gateway.internal/', 'root-secret');
        await expect(source.get('user/한글')).resolves.toEqual(projection);

        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe('http://gateway.internal/internal/account-icons/user%2F%ED%95%9C%EA%B8%80');
        expect(init?.headers).toMatchObject({
            'x-sammo-internal-token': expect.not.stringContaining('root-secret'),
        });
    });

    it('returns null only for a missing user', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(null, { status: 404 }))
        );
        await expect(new GatewayHttpAccountIconSource('http://gateway', 'secret').get('missing')).resolves.toBeNull();
    });

    it.each([401, 500])('rejects HTTP %s', async (status) => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(null, { status }))
        );
        await expect(new GatewayHttpAccountIconSource('http://gateway', 'secret').get('user')).rejects.toThrow(
            `HTTP ${status}`
        );
    });

    it('rejects malformed or over-broad responses', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ ...projection, email: 'must-not-leak@example.test' })))
        );
        await expect(new GatewayHttpAccountIconSource('http://gateway', 'secret').get('user')).rejects.toThrow(
            'invalid'
        );
    });

    it('loads only strict reset projections for the requested users', async () => {
        const fetchMock = vi.fn(
            async (_input: string | URL | Request, _init?: RequestInit) =>
                new Response(
                    JSON.stringify({
                        resets: [
                            {
                                userId: 'user-1',
                                resetRevision: '2026-07-31T09:00:00.001Z',
                                current: projection,
                            },
                        ],
                    })
                )
        );
        vi.stubGlobal('fetch', fetchMock);

        const source = new GatewayHttpAccountIconSource('http://gateway.internal/', 'root-secret');
        await expect(source.listResets(['user-1'])).resolves.toEqual([
            {
                userId: 'user-1',
                resetRevision: '2026-07-31T09:00:00.001Z',
                current: projection,
            },
        ]);
        expect(fetchMock.mock.calls[0]?.[0]).toBe('http://gateway.internal/internal/account-icon-resets');
        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
            method: 'POST',
            body: JSON.stringify({ userIds: ['user-1'] }),
        });
    });

    it('rejects reset projections for users that were not requested', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            resets: [
                                {
                                    userId: 'other-user',
                                    resetRevision: '2026-07-31T09:00:00.001Z',
                                    current: projection,
                                },
                            ],
                        })
                    )
            )
        );
        await expect(
            new GatewayHttpAccountIconSource('http://gateway', 'secret').listResets(['user-1'])
        ).rejects.toThrow('invalid');
    });
});
