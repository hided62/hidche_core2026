import assert from 'node:assert/strict';
import test from 'node:test';

import { createLatestRefreshQueue } from '../src/utils/latestRefreshQueue.ts';

void test('coalesces an event burst into one final refresh without losing it', async () => {
    const releases: Array<() => void> = [];
    let runs = 0;
    const queue = createLatestRefreshQueue(async () => {
        runs += 1;
        await new Promise<void>((resolve) => releases.push(resolve));
    });

    const first = queue.request();
    assert.equal(queue.isRunning(), true);
    const second = queue.request();
    const third = queue.request();
    assert.equal(second, first);
    assert.equal(third, first);
    assert.equal(runs, 1);

    releases.shift()?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(runs, 2);

    releases.shift()?.();
    await first;
    assert.equal(queue.isRunning(), false);
    assert.equal(runs, 2);
});
