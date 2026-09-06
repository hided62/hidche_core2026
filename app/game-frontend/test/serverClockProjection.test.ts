import assert from 'node:assert/strict';
import test from 'node:test';

import {
    millisecondsUntilNextMinute,
    projectServerClock,
    sampleServerClock,
} from '../src/utils/serverClockProjection.ts';

void test('projects a running server clock from the browser sample instant', () => {
    const sample = sampleServerClock(
        {
            serverTime: '2026-08-13T00:00:35.250Z',
            clockMode: 'realtime',
            clockRunning: true,
        },
        10_000
    );
    assert.ok(sample);
    assert.equal(projectServerClock(sample, 34_750).time.toISOString(), '2026-08-13T00:01:00.000Z');
    assert.equal(millisecondsUntilNextMinute(projectServerClock(sample, 10_000).time), 24_750);
});

void test('keeps manual clocks fixed even while client time advances', () => {
    const sample = sampleServerClock(
        { serverTime: '2026-08-13T00:00:35.000Z', clockMode: 'manual', clockRunning: false },
        10_000
    );
    assert.ok(sample);
    assert.equal(projectServerClock(sample, 130_000).time.toISOString(), '2026-08-13T00:00:35.000Z');
});

void test('holds a preopen clock until its wall-clock start delay passes', () => {
    const sample = sampleServerClock(
        {
            serverTime: '2026-08-13T00:00:00.000Z',
            serverWallTime: '2026-08-13T08:00:00.000Z',
            clockMode: 'realtime',
            clockRunning: false,
            clockStartsAt: '2026-08-13T08:01:00.000Z',
        },
        10_000
    );
    assert.ok(sample);
    assert.equal(projectServerClock(sample, 69_999).time.toISOString(), '2026-08-13T00:00:00.000Z');
    assert.equal(projectServerClock(sample, 70_001).time.toISOString(), '2026-08-13T00:00:00.001Z');
});

void test('rejects an invalid server clock sample', () => {
    assert.equal(sampleServerClock({ serverTime: 'not-a-time' }, 10_000), null);
});

void test('a single browser sample accelerates only inside the recovery window and rejoins normal time', () => {
    const sample = sampleServerClock(
        {
            serverTime: '2026-09-06T00:20:00Z',
            serverWallTime: '2026-09-06T04:20:00Z',
            clockRunning: true,
            clockRecovery: { startsAt: '2026-09-06T05:00:00Z', endsAt: '2026-09-06T09:00:00Z' },
        },
        0
    );
    assert.ok(sample);
    const minute = 60_000;
    assert.equal(projectServerClock(sample, 40 * minute).time.toISOString(), '2026-09-06T01:00:00.000Z');
    assert.equal(projectServerClock(sample, 100 * minute).time.toISOString(), '2026-09-06T03:00:00.000Z');
    assert.equal(projectServerClock(sample, 280 * minute).time.toISOString(), '2026-09-06T09:00:00.000Z');
    assert.equal(projectServerClock(sample, 340 * minute).time.toISOString(), '2026-09-06T10:00:00.000Z');
    assert.equal(projectServerClock(sample, 280 * minute).rate, 1);
});
