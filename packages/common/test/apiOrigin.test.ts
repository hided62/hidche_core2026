import { describe, expect, it } from 'vitest';
import { createApiOriginGuard, resolveApiAllowedOrigins } from '../src/http/apiOrigin.js';

describe('public API origin policy', () => {
    it('derives exact origins from application URLs and explicit extra origins', async () => {
        const origins = resolveApiAllowedOrigins('http://localhost:5173,https://sam.hided.net', [
            'https://sam.hided.net/gateway/',
            'https://sam.hided.net/che/',
        ]);
        expect(origins).toEqual(['https://sam.hided.net', 'http://localhost:5173']);
        const guard = createApiOriginGuard(origins);
        await expect(guard({ headers: {} })).resolves.toBeUndefined();
        for (const origin of origins) await expect(guard({ headers: { origin } })).resolves.toBeUndefined();
        for (const origin of [
            'https://untrusted.example',
            'https://sam.hided.net.untrusted.example',
            'http://sam.hided.net',
            'https://sam.hided.net:8443',
            'null',
            '',
            'https://sam.hided.net,https://untrusted.example',
            'x'.repeat(2049),
            ['https://sam.hided.net', 'https://untrusted.example'],
        ]) {
            await expect(guard({ headers: { origin } })).rejects.toMatchObject({ statusCode: 403 });
        }
    });

    it.each([
        '*',
        'null',
        'https://user:password@example.com',
        'file:///tmp/example',
        'https://x.test/path',
        'https://x.test?query',
        'https://x.test#fragment',
        'https://x.test,',
    ])('rejects unsafe configuration %s', (value) => {
        expect(() => resolveApiAllowedOrigins(value, [])).toThrow();
    });

    it('bounds configuration and fails closed when no public origin is configured', async () => {
        expect(() =>
            resolveApiAllowedOrigins(Array.from({ length: 33 }, (_, i) => `https://${i}.test`).join(','), [])
        ).toThrow();
        expect(() => resolveApiAllowedOrigins('https://' + 'a'.repeat(2048) + '.test', [])).toThrow();
        await expect(
            createApiOriginGuard([])({ headers: { origin: 'https://untrusted.example' } })
        ).rejects.toMatchObject({ statusCode: 403 });
    });
});
