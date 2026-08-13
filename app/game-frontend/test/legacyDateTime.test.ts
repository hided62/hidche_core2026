import assert from 'node:assert/strict';
import test from 'node:test';

import { formatSeoulDateTime, formatSeoulHourMinute, formatSeoulTimeSeconds } from '../src/utils/legacyDateTime.ts';

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
