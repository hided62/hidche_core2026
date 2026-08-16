import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTrpcQuery, extractDashboardRevisions } from '../src/trpc.js';

void test('tRPC query uses bearer auth without putting the token in the URL', () => {
    const token = 'ga_example_secret_token';
    const request = buildTrpcQuery(
        'http://127.0.0.1:15001',
        '/api/trpc',
        { name: 'own', procedure: 'dashboard.getContextBundleDelta', type: 'query', weight: 1, input: { include: { context: true } } },
        token
    );
    assert.equal(new Headers(request.init.headers).get('authorization'), `Bearer ${token}`);
    assert.equal(request.url.includes(token), false);
    assert.equal(new URL(request.url).pathname, '/api/trpc/dashboard.getContextBundleDelta');
    assert.deepEqual(JSON.parse(new URL(request.url).searchParams.get('input')!), { json: { include: { context: true } } });
});

void test('dashboard observations retain only opaque revisions and aggregate-safe result kinds', () => {
    const revision = 'Abcdefghijklmnopqrstuv';
    assert.deepEqual(
        extractDashboardRevisions({
            result: {
                data: {
                    json: {
                        context: { kind: 'unchanged', revision, data: { general: { id: 123 } } },
                        commandTable: { kind: 'snapshot', revision },
                    },
                },
            },
        }),
        { revisions: { context: revision, commandTable: revision }, resultKinds: ['unchanged', 'snapshot'] }
    );
});
