import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { ImageWorkBudget, performSignedImageUpload } from '../src/images/imageUpload.js';

const input = {
    kind: 'content' as const,
    baseUrl: 'https://image.example',
    filename: `${'a'.repeat(32)}.png`,
    contentType: 'image/png',
    body: Buffer.from('test'),
    secret: 'synthetic-image-secret',
};
const payload = () => new Response(JSON.stringify({ path: `uploads/core2026/${input.filename}` }));
const listen = async (server: Server) => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
};
const close = (server: Server) =>
    new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
    });

describe('bounded signed image transport', () => {
    it('never forwards signed PUT bodies across a real redirect', async () => {
        let forwarded = 0;
        const target = createServer((_, res) => {
            forwarded++;
            res.end(JSON.stringify({ path: `uploads/core2026/${input.filename}` }));
        });
        const targetUrl = await listen(target);
        const origin = createServer((_, res) => {
            res.writeHead(307, { location: targetUrl });
            res.end();
        });
        const baseUrl = await listen(origin);
        try {
            await expect(performSignedImageUpload({ ...input, baseUrl })).rejects.toThrow();
            expect(forwarded).toBe(0);
        } finally {
            await close(origin);
            await close(target);
        }
    });
    it('bounds streamed bytes independently of Content-Length', async () => {
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(10_000));
                controller.enqueue(new Uint8Array(10_000));
            },
        });
        await expect(performSignedImageUpload(input, async () => new Response(body))).rejects.toThrow('size limit');
    });
    it('rejects wrong and malformed JSON paths', async () => {
        for (const body of ['{', JSON.stringify({ path: 'elsewhere' })]) {
            await expect(performSignedImageUpload(input, async () => new Response(body))).rejects.toThrow();
        }
    });
    it('keeps timed-out non-cooperative work admitted until it actually settles', async () => {
        const budget = new ImageWorkBudget(1);
        let resolve!: (response: Response) => void;
        const fetchImpl: typeof fetch = () =>
            new Promise<Response>((done) => {
                resolve = done;
            });
        await expect(performSignedImageUpload(input, fetchImpl, Date.now, { timeoutMs: 25, budget })).rejects.toThrow(
            'timed out'
        );
        await expect(performSignedImageUpload(input, async () => payload(), Date.now, { budget })).rejects.toThrow(
            'busy'
        );
        resolve(payload());
        await new Promise<void>((done) => setImmediate(done));
        await expect(
            performSignedImageUpload(input, async () => payload(), Date.now, { budget })
        ).resolves.toBeUndefined();
    });
    it.each(['headers', 'body'])(
        'aborts a real stalled %s response within the whole request deadline',
        async (phase) => {
            const server = createServer((_, res) => {
                if (phase === 'body') {
                    res.writeHead(201);
                    res.write('{');
                }
            });
            const baseUrl = await listen(server);
            try {
                await expect(
                    performSignedImageUpload({ ...input, baseUrl }, fetch, Date.now, { timeoutMs: 100 })
                ).rejects.toThrow('timed out');
            } finally {
                await close(server);
            }
        }
    );
});
