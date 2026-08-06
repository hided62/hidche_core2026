import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RemoteUserIconStore } from '../src/account/remoteUserIconStore.js';

describe('remote user icon store', () => {
    it('uses a short-lived path and body-bound HMAC without sending the shared secret', async () => {
        const body = Buffer.from('icon-body');
        const secret = 'u'.repeat(32);
        let captured: { input: string | URL | Request; init?: RequestInit } | undefined;
        const fetchImpl: typeof fetch = async (input, init) => {
            captured = { input, init };
            return new Response(JSON.stringify({ path: `icons/users/core2026/${'a'.repeat(32)}.png` }), {
                status: 201,
            });
        };
        const store = new RemoteUserIconStore(
            'https://sam-image.hided.net/',
            'https://sam-image.hided.net/icons/',
            secret,
            fetchImpl,
            () => Date.parse('2026-08-06T00:00:00.000Z')
        );

        const result = await store.upload({
            filename: `${'a'.repeat(32)}.png`,
            contentType: 'image/png',
            body,
        });

        expect(result).toEqual({
            picture: `users/core2026/${'a'.repeat(32)}.png`,
            publicUrl: `https://sam-image.hided.net/icons/users/core2026/${'a'.repeat(32)}.png`,
        });
        expect(String(captured?.input)).toBe(
            `https://sam-image.hided.net/v1/uploads/user-icons/core2026/${'a'.repeat(32)}.png`
        );
        const headers = captured?.init?.headers as Record<string, string>;
        expect(headers['x-image-expires']).toBe(String(Date.parse('2026-08-06T00:01:00.000Z') / 1000));
        expect(Object.values(headers)).not.toContain(secret);
        const pathname = `/v1/uploads/user-icons/core2026/${'a'.repeat(32)}.png`;
        const digest = createHash('sha256').update(body).digest('hex');
        const expected = createHmac('sha256', secret)
            .update(
                `${headers['x-image-expires']}.${headers['x-image-request-id']}.${pathname}.image/png.${digest}`
            )
            .digest('hex');
        expect(headers['x-image-signature']).toBe(expected);
    });

    it('does not return a picture when the image service rejects the grant', async () => {
        const store = new RemoteUserIconStore(
            'https://sam-image.hided.net',
            'https://sam-image.hided.net/icons',
            'u'.repeat(32),
            async () => new Response('{}', { status: 401 })
        );
        await expect(
            store.upload({ filename: `${'b'.repeat(32)}.png`, contentType: 'image/png', body: Buffer.from('x') })
        ).rejects.toThrow('HTTP 401');
    });
});
