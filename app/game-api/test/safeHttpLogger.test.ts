import { Writable } from 'node:stream';
import fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { safeHttpLoggerOptions, safeHttpErrorHandler } from '@sammo-ts/common';

describe('HTTP log credential boundaries', () => {
    it('logs static routes/status but no query, unmatched path, header, body, stack or cause secrets', async () => {
        let output = '';
        const stream = new Writable({
            write(chunk, _encoding, done) {
                output += String(chunk);
                done();
            },
        });
        const app = fastify({ logger: { ...safeHttpLoggerOptions, stream } });
        app.setErrorHandler(safeHttpErrorHandler);
        app.post('/events', async () => {
            throw Object.assign(new Error('synthetic-error-secret', { cause: new Error('synthetic-cause-secret') }), {
                code: 'P2002',
                detail: 'synthetic-detail-secret',
            });
        });
        try {
            const address = await app.listen({ host: '127.0.0.1', port: 0 });
            const response = await fetch(`${address}/events?token=synthetic-query-secret`, {
                method: 'POST',
                headers: { authorization: 'Bearer synthetic-header-secret', 'content-type': 'application/json' },
                body: JSON.stringify({ password: 'synthetic-body-secret' }),
            });
            expect(await response.json()).toMatchObject({ message: 'Internal server error' });
            await fetch(`${address}/synthetic-path-secret`);
            const logs = output
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            expect(logs.some((entry) => entry.req?.url === '/events')).toBe(true);
            expect(logs.some((entry) => entry.res?.statusCode === 500)).toBe(true);
            expect(logs.some((entry) => entry.err?.code === 'P2002')).toBe(true);
            for (const field of ['query', 'header', 'body', 'error', 'cause', 'detail', 'path']) {
                expect(output).not.toContain(`synthetic-${field}-secret`);
            }
        } finally {
            await app.close();
        }
    });
});
