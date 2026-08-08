import { createHmac } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { syncImageRepository } from './sync-image-repository.mjs';

test('signs a scoped Core2026 fallback sync without exposing the secret', async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sammo-image-sync-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const secretFile = path.join(directory, 'secret');
    const secret = 's'.repeat(32);
    await writeFile(secretFile, `${secret}\n`, { mode: 0o600 });
    let captured;
    const result = await syncImageRepository({
        baseUrl: 'https://sam-image.hided.net/',
        secretFile,
        commit: 'a'.repeat(40),
        now: () => Date.parse('2026-08-08T00:00:00Z'),
        requestIdFactory: () => 'request-1',
        fetchImpl: async (url, init) => {
            captured = { url, init };
            return new Response(JSON.stringify({ ok: true, changed: false }), { status: 200 });
        },
    });

    assert.deepEqual(result, { ok: true, changed: false });
    assert.equal(captured.url, 'https://sam-image.hided.net/v1/sync');
    assert.equal(captured.init.body, JSON.stringify({ commit: 'a'.repeat(40) }));
    assert.equal(captured.init.headers['x-image-client'], 'core2026');
    assert.equal(
        captured.init.headers['x-image-signature'],
        createHmac('sha256', secret)
            .update(`${captured.init.headers['x-image-timestamp']}.request-1.${captured.init.body}`)
            .digest('hex')
    );
    assert.equal(Object.values(captured.init.headers).includes(secret), false);
});

test('rejects invalid commits before reading the secret or making a request', async () => {
    await assert.rejects(
        syncImageRepository({
            secretFile: '/does/not/exist',
            commit: 'main',
            fetchImpl: async () => {
                throw new Error('must not fetch');
            },
        }),
        /Commit must be a full/
    );
});

test('reports authentication failures without returning a response body', async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sammo-image-sync-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const secretFile = path.join(directory, 'secret');
    await writeFile(secretFile, 's'.repeat(32), { mode: 0o600 });
    await assert.rejects(
        syncImageRepository({
            secretFile,
            fetchImpl: async () => new Response('{"reason":"sensitive detail"}', { status: 401 }),
        }),
        /HTTP 401/
    );
});
