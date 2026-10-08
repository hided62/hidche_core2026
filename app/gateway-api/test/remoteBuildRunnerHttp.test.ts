import { createServer, type Server, type ServerResponse, type IncomingMessage } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RemoteBuildRunner } from '../src/orchestrator/buildRunner.js';

describe('release builder authenticated HTTP and bounded responses', () => {
    let directory: string;
    let tokenFile: string;
    const servers: Server[] = [];
    beforeEach(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-build-http-'));
        tokenFile = path.join(directory, 'token');
        await fs.writeFile(tokenFile, 't'.repeat(64), { mode: 0o600 });
    });
    afterEach(async () => {
        for (const server of servers.splice(0)) {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        await fs.rm(directory, { recursive: true, force: true });
    });
    const provider = async (handler: (req: IncomingMessage, res: ServerResponse) => void) => {
        const server = createServer(handler);
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable.');
        return `http://127.0.0.1:${address.port}`;
    };
    const commands = [{ command: 'pnpm', args: ['install', '--frozen-lockfile'], cwd: '/srv/core/repository' }];
    it('sends the file token only as a header and preserves successful stream results', async () => {
        let received = '';
        const endpoint = await provider((req, res) => {
            expect(req.headers['x-release-builder-token']).toBe('t'.repeat(64));
            req.on('data', (chunk: Buffer) => {
                received += chunk.toString();
            });
            req.on('end', () => res.end(`${JSON.stringify({ result: { ok: true, exitCode: 0, output: 'done' } })}\n`));
        });
        expect(await new RemoteBuildRunner(endpoint, fetch, { tokenFile }).run(commands)).toMatchObject({
            ok: true,
            output: 'done',
        });
        expect(received).not.toContain('t'.repeat(64));
    });
    it('fails closed without a valid credential before sending a request', async () => {
        let requests = 0;
        const endpoint = await provider((_req, res) => {
            requests += 1;
            res.end();
        });
        const result = await new RemoteBuildRunner(endpoint).run(commands);
        expect(result.ok).toBe(false);
        expect(requests).toBe(0);
        expect(result.output).not.toContain(directory);
    });
    it('rejects malformed and oversized progress without exposing upstream error payloads', async () => {
        for (const body of [
            '{"event":{"type":"OUTPUT","stream":"stdout","message":42}}\n',
            'x'.repeat(512 * 1024 + 1),
            'null\n',
            '{"result":{"ok":true,"exitCode":2,"output":""}}\n',
        ]) {
            const endpoint = await provider((_req, res) => res.end(body));
            expect((await new RemoteBuildRunner(endpoint, fetch, { tokenFile }).run(commands)).ok).toBe(false);
        }
        const endpoint = await provider((_req, res) => {
            res.writeHead(500);
            res.end('synthetic-sensitive-detail'.repeat(100_000));
        });
        const result = await new RemoteBuildRunner(endpoint, fetch, { tokenFile }).run(commands);
        expect(result.output).toBe('Release builder returned HTTP 500.');
        const rejected = await provider((_req, res) =>
            res.end(JSON.stringify({ error: 'synthetic-sensitive-detail' }) + '\n')
        );
        expect((await new RemoteBuildRunner(rejected, fetch, { tokenFile }).run(commands)).output).toBe(
            'Release builder rejected the build request.'
        );
    });
    it('does not forward the token to redirect destinations', async () => {
        let requests = 0;
        const destination = await provider((_req, res) => {
            requests += 1;
            res.end();
        });
        const endpoint = await provider((_req, res) => {
            res.writeHead(307, { location: destination });
            res.end();
        });
        expect((await new RemoteBuildRunner(endpoint, fetch, { tokenFile }).run(commands)).ok).toBe(false);
        expect(requests).toBe(0);
    });
    it('bounds header/body stalls and preserves explicit operator cancellation', async () => {
        const silent = await provider(() => {});
        expect((await new RemoteBuildRunner(silent, fetch, { tokenFile, timeoutMs: 100 }).run(commands)).ok).toBe(
            false
        );
        const partial = await provider((_req, res) => {
            res.writeHead(200);
            res.write('{');
        });
        expect((await new RemoteBuildRunner(partial, fetch, { tokenFile, timeoutMs: 100 }).run(commands)).ok).toBe(
            false
        );
        const controller = new AbortController();
        const pending = new RemoteBuildRunner(partial, fetch, { tokenFile }).run(commands, undefined, {
            signal: controller.signal,
        });
        controller.abort();
        expect(await pending).toMatchObject({ ok: false, aborted: true, output: 'Build cancelled by operator.' });
    });
});
