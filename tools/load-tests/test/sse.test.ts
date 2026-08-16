import assert from 'node:assert/strict';
import test from 'node:test';

import { containsForbiddenPublicField, SseParser } from '../src/sse.js';

void test('SSE parser handles chunk boundaries, CRLF, comments, and multiline data', () => {
    const events: Array<{ event: string; data: string }> = [];
    const parser = new SseParser((event) => events.push(event));
    parser.push(': keepalive\r\nevent: rea');
    parser.push('dy\r\ndata: {"ok":\r\ndata: true}\r\n\r\n');
    parser.finish();
    assert.deepEqual(events, [{ event: 'ready', data: '{"ok":\ntrue}' }]);
});

void test('public payload privacy scan checks nested forbidden identifiers and timing fields', () => {
    assert.equal(containsForbiddenPublicField({ type: 'readModelInvalidated', context: true }), false);
    assert.equal(containsForbiddenPublicField({ nested: { generalId: 3 } }), true);
    assert.equal(containsForbiddenPublicField([{ lastTurnTime: 'secret' }]), true);
});
