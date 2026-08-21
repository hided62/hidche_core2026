import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTrpcProcedures } from '../src/pageNavigation.js';

void test('tRPC page-load requests are attributed for single and batched procedures', () => {
    assert.deepEqual(
        parseTrpcProcedures('http://127.0.0.1:15001/api/trpc/auth.status?batch=1&input=%7B%7D', '/api/trpc'),
        ['auth.status']
    );
    assert.deepEqual(
        parseTrpcProcedures(
            'http://127.0.0.1:15001/api/trpc/world.getMap%2Cworld.getMapLayout?batch=1',
            '/api/trpc'
        ),
        ['world.getMap', 'world.getMapLayout']
    );
    assert.deepEqual(parseTrpcProcedures('http://127.0.0.1:15001/healthz', '/api/trpc'), []);
});
