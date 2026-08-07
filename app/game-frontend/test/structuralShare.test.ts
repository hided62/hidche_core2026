import assert from 'node:assert/strict';
import test from 'node:test';

import { structurallyShare } from '../src/utils/structuralShare.ts';

void test('reuses a completely unchanged tRPC snapshot', () => {
    const current = {
        general: { id: 7, name: '장수' },
        records: [{ id: 3, text: '기록' }],
        createdAt: new Date('2026-08-07T00:00:00.000Z'),
    };
    const incoming = {
        general: { id: 7, name: '장수' },
        records: [{ id: 3, text: '기록' }],
        createdAt: new Date('2026-08-07T00:00:00.000Z'),
    };

    assert.equal(structurallyShare(current, incoming), current);
});

void test('replaces only changed branches and preserves sibling identities', () => {
    const current = {
        general: { id: 7, name: '이전 이름' },
        city: { id: 1, name: '업' },
        records: [{ id: 3, text: '기록' }],
    };
    const incoming = {
        general: { id: 7, name: '새 이름' },
        city: { id: 1, name: '업' },
        records: [{ id: 3, text: '기록' }],
    };

    const shared = structurallyShare(current, incoming);
    assert.notEqual(shared, current);
    assert.notEqual(shared.general, current.general);
    assert.deepEqual(shared.general, incoming.general);
    assert.equal(shared.city, current.city);
    assert.equal(shared.records, current.records);
});
