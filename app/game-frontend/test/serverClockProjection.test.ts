import assert from 'node:assert/strict';
import test from 'node:test';

import {
    millisecondsUntilNextMinute,
    projectServerClock,
    projectRecoveryTime,
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

void test('waits then accelerates from a partial month and returns to normal without resampling', () => {
    const sample = sampleServerClock(
        {
            serverTime: '2026-09-07T00:10:00Z',
            serverWallTime: '2026-09-07T00:24:00Z',
            clockMode: 'realtime',
            clockRunning: false,
            clockStartsAt: '2026-09-07T00:35:00Z',
            clockRecovery: { startsAt: '2026-09-07T00:35:00Z', endsAt: '2026-09-07T01:00:00Z' },
        },
        0
    );
    assert.ok(sample);
    for (const elapsed of [0, 660000 - 1, 660000]) {
        assert.equal(projectServerClock(sample, elapsed).time.toISOString(), '2026-09-07T00:10:00.000Z');
    }
    assert.equal(projectServerClock(sample, 660001).time.toISOString(), '2026-09-07T00:10:00.002Z');
    assert.equal(projectServerClock(sample, 2160000 - 1).time.toISOString(), '2026-09-07T00:59:59.998Z');
    assert.equal(projectServerClock(sample, 2160000 - 1).rate, 2);
    assert.equal(projectServerClock(sample, 2160000).time.toISOString(), '2026-09-07T01:00:00.000Z');
    assert.equal(projectServerClock(sample, 2160000).rate, 1);
    assert.equal(projectServerClock(sample, 2160001).time.toISOString(), '2026-09-07T01:00:00.001Z');
});

void test('actual deadlines compress only the recovery window and preserve the original phase afterward', () => {
    const sample = sampleServerClock(
        {
            serverTime: '2026-09-10T01:00:00Z',
            serverWallTime: '2026-09-10T02:00:00Z',
            clockRunning: true,
            clockRecovery: { startsAt: '2026-09-10T02:00:00Z', endsAt: '2026-09-10T03:00:00Z' },
        },
        0
    );
    assert.ok(sample);
    for (const [game, actual] of [
        ['01:20', '02:10'],
        ['02:20', '02:40'],
        ['03:20', '03:20'],
        ['01:00', '02:00'],
        ['03:00', '03:00'],
    ]) {
        assert.equal(
            projectRecoveryTime(sample, new Date(`2026-09-10T${game}:00Z`)).toISOString(),
            `2026-09-10T${actual}:00.000Z`
        );
    }
    // Recovery resampling must not move a deadline, even with a skewed browser clock.
    const middle = sampleServerClock(
        {
            serverTime: '2026-09-10T02:00:00Z',
            serverWallTime: '2026-09-10T02:30:00Z',
            clockRecovery: { startsAt: '2026-09-10T02:00:00Z', endsAt: '2026-09-10T03:00:00Z' },
        },
        1234567
    );
    assert.equal(
        projectRecoveryTime(middle, new Date('2026-09-10T02:20:00Z')).toISOString(),
        '2026-09-10T02:40:00.000Z'
    );
});

void test('actual deadline projection handles waiting, missing metadata, stopped clocks and historical dates', () => {
    const input = {
        serverTime: '2026-09-10T00:10:00Z',
        serverWallTime: '2026-09-10T00:24:00Z',
        clockRunning: false,
        clockStartsAt: '2026-09-10T00:35:00Z',
        clockRecovery: { startsAt: '2026-09-10T00:35:00Z', endsAt: '2026-09-10T01:00:00Z' },
    };
    const target = new Date('2026-09-10T00:20:00Z');
    assert.equal(projectRecoveryTime(sampleServerClock(input, 0), target).toISOString(), '2026-09-10T00:40:00.000Z');
    const history = new Date('2026-09-09T23:00:00Z');
    assert.equal(projectRecoveryTime(sampleServerClock(input, 0), history), history);
    assert.equal(projectRecoveryTime(sampleServerClock({ ...input, clockStartsAt: null }, 0), target), target);
    assert.equal(projectRecoveryTime(sampleServerClock({ ...input, clockMode: 'manual' }, 0), target), target);
    assert.equal(projectRecoveryTime(sampleServerClock({ ...input, clockRecovery: null }, 0), target), target);
    assert.equal(projectRecoveryTime(null, target), target);
});
