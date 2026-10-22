import { Agent, request as httpsRequest } from 'node:https';
import { createPublicPushLookup, PushEndpointPolicyError } from '../src/webPush/endpointPolicy.js';
import { createServer, request, type Server } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { sendPushRequest } from '../src/webPush/sendNotification.js';

const details = {
    endpoint: 'https://push.example/subscription',
    method: 'POST' as const,
    headers: {},
    body: Buffer.from('encrypted'),
};
const listen = async (server: Server) => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return (server.address() as { port: number }).port;
};
const close = (server: Server) =>
    new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
    });
const transport =
    (port: number): Parameters<typeof sendPushRequest>[1] =>
    (options, callback) =>
        request({ ...options, protocol: 'http:', hostname: '127.0.0.1', port, agent: undefined }, callback);

describe('bounded WebPush response transport', () => {
    it('accepts normal success and preserves terminal HTTP status without retaining sensitive response bodies', async () => {
        let status = 201;
        const server = createServer((_, res) => {
            res.writeHead(status);
            res.end('private upstream details');
        });
        const port = await listen(server);
        try {
            await expect(sendPushRequest(details, transport(port))).resolves.toBeUndefined();
            status = 410;
            await expect(sendPushRequest(details, transport(port))).rejects.toMatchObject({
                statusCode: 410,
                message: 'Push service returned HTTP 410.',
            });
        } finally {
            await close(server);
        }
    });
    it.each([true, false])('rejects oversized response with declared length %s', async (declared) => {
        const server = createServer((_, res) => {
            if (declared) res.setHeader('content-length', 20_000);
            res.end(Buffer.alloc(20_000));
        });
        const port = await listen(server);
        try {
            await expect(sendPushRequest(details, transport(port))).rejects.toThrow('size limit');
        } finally {
            await close(server);
        }
    });
    it('ends a continuously dripping response on the whole exchange deadline', async () => {
        const server = createServer((_, res) => {
            const timer = setInterval(() => res.write('x'), 10);
            res.on('close', () => clearInterval(timer));
        });
        const port = await listen(server);
        try {
            await expect(sendPushRequest(details, transport(port), 100)).rejects.toThrow('timed out');
        } finally {
            await close(server);
        }
    });
    it('preserves terminal public-address policy failures from actual socket lookup', async () => {
        const agent = new Agent({ lookup: createPublicPushLookup(async () => [{ address: '127.0.0.1', family: 4 }]) });
        try {
            await expect(
                sendPushRequest(details, (options, callback) => httpsRequest({ ...options, agent }, callback))
            ).rejects.toBeInstanceOf(PushEndpointPolicyError);
        } finally {
            agent.destroy();
        }
    });

    it('does not follow redirects', async () => {
        let calls = 0;
        const server = createServer((_, res) => {
            calls++;
            res.writeHead(307, { location: 'https://elsewhere.example' });
            res.end();
        });
        const port = await listen(server);
        try {
            await expect(sendPushRequest(details, transport(port))).rejects.toMatchObject({ statusCode: 307 });
            expect(calls).toBe(1);
        } finally {
            await close(server);
        }
    });
});
