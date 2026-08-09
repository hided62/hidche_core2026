import assert from 'node:assert/strict';
import test from 'node:test';

import { createRateLimitedRefreshQueue } from '../src/utils/rateLimitedRefreshQueue.ts';

void test('bounds a sustained event burst and retains one trailing refresh', async () => {
    let nowMs = 0;
    let runs = 0;
    let nextTimerId = 1;
    const timers = new Map<number, { callback: () => void; at: number }>();
    const releases: Array<() => void> = [];
    const queue = createRateLimitedRefreshQueue(
        async () => {
            runs += 1;
            await new Promise<void>((resolve) => releases.push(resolve));
        },
        {
            minIntervalMs: 5_000,
            now: () => nowMs,
            setTimer: (callback, delayMs) => {
                const id = nextTimerId++;
                timers.set(id, { callback, at: nowMs + delayMs });
                return id as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimer: (timer) => timers.delete(timer as unknown as number),
        }
    );

    const runDueTimers = () => {
        for (const [id, timer] of [...timers]) {
            if (timer.at <= nowMs) {
                timers.delete(id);
                timer.callback();
            }
        }
    };

    queue.request();
    runDueTimers();
    assert.equal(runs, 1);

    for (let index = 0; index < 100; index += 1) queue.request();
    releases.shift()?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(runs, 1);
    assert.equal(timers.size, 1);

    nowMs = 4_999;
    runDueTimers();
    assert.equal(runs, 1);
    nowMs = 5_000;
    runDueTimers();
    assert.equal(runs, 2);

    releases.shift()?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(queue.isRunning(), false);
});

void test('cancels a pending trailing refresh', () => {
    let timerCallback: (() => void) | null = null;
    let runs = 0;
    const queue = createRateLimitedRefreshQueue(async () => {
        runs += 1;
    }, {
        minIntervalMs: 5_000,
        now: () => 0,
        setTimer: (callback) => {
            timerCallback = callback;
            return 1 as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => {
            timerCallback = null;
        },
    });

    queue.beginCooldown();
    queue.request();
    queue.cancelPending();
    assert.equal(timerCallback, null);
    assert.equal(runs, 0);
    assert.equal(queue.isRunning(), false);
});
