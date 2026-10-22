import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import { createAuthenticatedEventSource } from '../src/utils/authenticatedEventSource.ts';

const listen = (server: Server): Promise<string> =>
    new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
            resolve(`http://127.0.0.1:${address.port}`);
        });
    });
const stop = (server: Server): Promise<void> =>
    new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
    });

void test(
    'reconnects with header auth, omits ambient credentials and preserves named UTF-8 SSE events',
    { timeout: 5_000 },
    async () => {
        const requests: Array<{ url: string; authorization: string | undefined; cookie: string | undefined }> = [];
        const server = createServer((request, response) => {
            requests.push({
                url: request.url!,
                authorization: request.headers.authorization,
                cookie: request.headers.cookie,
            });
            response.writeHead(200, { 'content-type': 'text/event-stream' });
            response.write(
                `retry: 20\nevent: update\ndata: ${JSON.stringify({ value: '갱신', attempt: requests.length })}\n\n`
            );
            if (requests.length === 1) response.end();
        });
        const origin = await listen(server);
        const source = createAuthenticatedEventSource(`${origin}/events?scope=tournament`, 'ga_synthetic-fixture');
        try {
            const events: unknown[] = [];
            await new Promise<void>((resolve) =>
                source.addEventListener('update', (event) => {
                    events.push(JSON.parse(event.data));
                    if (events.length === 2) resolve();
                })
            );
            assert.deepEqual(events, [
                { value: '갱신', attempt: 1 },
                { value: '갱신', attempt: 2 },
            ]);
            assert.deepEqual(
                requests,
                Array.from({ length: 2 }, () => ({
                    url: '/events?scope=tournament',
                    authorization: 'Bearer ga_synthetic-fixture',
                    cookie: undefined,
                }))
            );
        } finally {
            source.close();
            await stop(server);
        }
    }
);

void test('401 is terminal and redirects never forward the authorization header', { timeout: 5_000 }, async () => {
    let redirectedRequests = 0;
    const target = createServer((_req, res) => {
        redirectedRequests += 1;
        res.writeHead(200);
        res.end();
    });
    const targetOrigin = await listen(target);
    const server = createServer((req, res) => {
        res.writeHead(req.url === '/unauthorized' ? 401 : 302, { location: targetOrigin });
        res.end();
    });
    const origin = await listen(server);
    try {
        for (const endpoint of ['unauthorized', 'redirect']) {
            const source = createAuthenticatedEventSource(`${origin}/${endpoint}`, 'ga_synthetic-fixture');
            try {
                const code = await new Promise<number | undefined>((resolve) =>
                    source.addEventListener('error', (event) => resolve(event.code))
                );
                if (endpoint === 'unauthorized') {
                    assert.equal(code, 401);
                    assert.equal(source.readyState, source.CLOSED);
                }
            } finally {
                source.close();
            }
        }
        assert.equal(redirectedRequests, 0);
    } finally {
        await stop(server);
        await stop(target);
    }
});

void test('rejects configured query or URL credentials before connecting', () => {
    assert.throws(() => createAuthenticatedEventSource('http://localhost/events?token=synthetic', 'ga_synthetic'));
    assert.throws(() => createAuthenticatedEventSource('http://user:synthetic@localhost/events', 'ga_synthetic'));
});
