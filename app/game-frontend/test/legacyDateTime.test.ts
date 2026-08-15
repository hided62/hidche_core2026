import assert from 'node:assert/strict';
import test from 'node:test';

import {
    formatLocalTimeSeconds,
    formatSeoulDateTime,
    formatSeoulHourMinute,
    formatSeoulTimeSeconds,
} from '../src/utils/legacyDateTime.ts';

void test('formats API UTC timestamps in the server Seoul timezone', () => {
    assert.equal(formatSeoulDateTime('2026-08-13T00:07:06.713Z'), '2026-08-13 09:07:06');
    assert.equal(formatSeoulHourMinute('2026-08-13T00:07:06.713Z'), '09:07');
    assert.equal(formatSeoulTimeSeconds('2026-08-13T00:07:06.713Z'), '09:07:06');
});

void test('keeps legacy timezone-less server timestamps unchanged', () => {
    assert.equal(formatSeoulDateTime('2026-08-13 09:07:06'), '2026-08-13 09:07:06');
    assert.equal(formatSeoulHourMinute('2026-08-13 09:07:06'), '09:07');
    assert.equal(formatSeoulTimeSeconds('2026-08-13 09:07:06'), '09:07:06');
});

void test('formats an ISO instant with the client local clock', () => {
    const instant = new Date('2026-08-13T00:07:06.713Z');
    const expected = [instant.getHours(), instant.getMinutes(), instant.getSeconds()]
        .map((part) => String(part).padStart(2, '0'))
        .join(':');
    assert.equal(formatLocalTimeSeconds(instant), expected);
    assert.equal(formatLocalTimeSeconds(instant.toISOString()), expected);
    assert.equal(formatLocalTimeSeconds('invalid'), '-');
});
