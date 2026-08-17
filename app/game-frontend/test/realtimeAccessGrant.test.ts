import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createRealtimeRequestOptions,
    REALTIME_ACCESS_GRANT_CONTEXT_KEY,
    resolveBatchRealtimeAccessGrant,
} from '../src/utils/realtimeAccessGrant.ts';

void test('adds a realtime grant only to server-signaled request options', () => {
    assert.deepEqual(createRealtimeRequestOptions('grant-a'), {
        context: { [REALTIME_ACCESS_GRANT_CONTEXT_KEY]: 'grant-a' },
    });
    assert.equal(createRealtimeRequestOptions(undefined), undefined);
});

void test('sets a batch grant only when every operation carries the same proof', () => {
    assert.equal(
        resolveBatchRealtimeAccessGrant([
            { context: { [REALTIME_ACCESS_GRANT_CONTEXT_KEY]: 'grant-a' } },
            { context: { [REALTIME_ACCESS_GRANT_CONTEXT_KEY]: 'grant-a' } },
        ]),
        'grant-a'
    );
    assert.equal(
        resolveBatchRealtimeAccessGrant([
            { context: { [REALTIME_ACCESS_GRANT_CONTEXT_KEY]: 'grant-a' } },
            { context: {} },
        ]),
        undefined
    );
    assert.equal(
        resolveBatchRealtimeAccessGrant([
            { context: { [REALTIME_ACCESS_GRANT_CONTEXT_KEY]: 'grant-a' } },
            { context: { [REALTIME_ACCESS_GRANT_CONTEXT_KEY]: 'grant-b' } },
        ]),
        undefined
    );
});
