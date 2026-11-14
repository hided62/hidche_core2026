import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { bootIdentity, createBootIdentityServer } from './windows-boot-agent.mjs';

test('agent restart preserves OS boot identity; a new OS boot changes it', () => {
    assert.equal(bootIdentity('HOST', '638985120000000000'), bootIdentity('host', '638985120000000000'));
    assert.notEqual(bootIdentity('HOST', '638985120000000000'), bootIdentity('HOST', '638985120000000001'));
    assert.throws(() => bootIdentity('HOST', 'invalid'));
});

test('HTTP transport rejects anonymous requests and signs the current challenge and boot identity', async () => {
    const key = randomBytes(32);
    let bootId = 'a'.repeat(64);
    const server = createBootIdentityServer({ key, getBootId: () => bootId });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/v1/boot-id`;
    after(
        () =>
            new Promise((resolve) => {
                server.close(resolve);
                server.closeAllConnections();
            })
    );
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(`${url}?bypass=1`)).status, 404);
    const challenge = randomBytes(32).toString('hex');
    const signature = createHmac('sha256', key).update(`sammo-host-boot-request-v1\n${challenge}`).digest('hex');
    const headers = { 'x-sammo-challenge': challenge, 'x-sammo-signature': signature };
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.challenge, challenge);
    const expected = createHmac('sha256', key).update(`sammo-host-boot-response-v1\n${challenge}\n${bootId}`).digest();
    assert.ok(timingSafeEqual(expected, Buffer.from(body.signature, 'hex')));
    bootId = 'b'.repeat(64);
    assert.equal((await (await fetch(url, { headers })).json()).bootId, bootId);
    assert.equal((await fetch(url, { headers: { ...headers, 'x-sammo-signature': '0'.repeat(64) } })).status, 401);
});
