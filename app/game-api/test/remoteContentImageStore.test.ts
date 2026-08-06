import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RemoteContentImageStore } from '../src/services/remoteContentImageStore.js';

describe('remote content image store', () => {
    it('signs a 60-second body-bound content upload and validates its returned path', async () => {
        const filename = `${'c'.repeat(32)}.webp`;
        const body = Buffer.from('content-body');
        const secret = 'u'.repeat(32);
        let captured: { input: string | URL | Request; init?: RequestInit } | undefined;
        const fetchImpl: typeof fetch = async (input, init) => {
            captured = { input, init };
            return new Response(JSON.stringify({ path: `uploads/core2026/${filename}` }), { status: 201 });
        };
        const store = new RemoteContentImageStore(
            'https://sam-image.hided.net',
            'https://sam-image.hided.net/uploads/core2026',
            secret,
            fetchImpl,
            () => Date.parse('2026-08-06T00:00:00.000Z')
        );

        await expect(store.upload({ filename, contentType: 'image/webp', body })).resolves.toEqual({
            publicUrl: `https://sam-image.hided.net/uploads/core2026/${filename}`,
        });
        const headers = captured?.init?.headers as Record<string, string>;
        const pathname = `/v1/uploads/content/core2026/${filename}`;
        const digest = createHash('sha256').update(body).digest('hex');
        expect(headers['x-image-signature']).toBe(
            createHmac('sha256', secret)
                .update(
                    `${headers['x-image-expires']}.${headers['x-image-request-id']}.${pathname}.image/webp.${digest}`
                )
                .digest('hex')
        );
        expect(String(captured?.input)).toBe(`https://sam-image.hided.net${pathname}`);
        expect(Object.values(headers)).not.toContain(secret);
    });
});
