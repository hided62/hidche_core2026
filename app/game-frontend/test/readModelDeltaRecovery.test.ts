import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWithReadModelSnapshotFallback } from '../src/utils/readModelDeltaRecovery.ts';

void test('retries any local delta application failure once with a forced snapshot', async () => {
    const requests: boolean[] = [];
    const result = await resolveWithReadModelSnapshotFallback({
        request: async (forceSnapshot) => {
            requests.push(forceSnapshot);
            return forceSnapshot ? { kind: 'snapshot', value: 25 } : { kind: 'patch', value: 20 };
        },
        resolve: (response) => {
            if (response.kind === 'patch') {
                throw new DOMException('[object Object] could not be cloned.', 'DataCloneError');
            }
            return response.value;
        },
    });

    assert.equal(result, 25);
    assert.deepEqual(requests, [false, true]);
});

void test('does not retry a forced snapshot application failure', async () => {
    const requests: boolean[] = [];

    await assert.rejects(
        resolveWithReadModelSnapshotFallback({
            forceSnapshot: true,
            request: async (forceSnapshot) => {
                requests.push(forceSnapshot);
                return { kind: 'snapshot' };
            },
            resolve: () => {
                throw new Error('snapshot failure');
            },
        }),
        /snapshot failure/u
    );
    assert.deepEqual(requests, [true]);
});
