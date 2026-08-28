import assert from 'node:assert/strict';
import test from 'node:test';

import {
    amplifyPattern,
    extractPattern,
    generalTurnEditorModeStorageKey,
    moveQueueRange,
    normalizedSelection,
    selectStep,
} from '../src/components/command/commandQueue.ts';

void test('scopes the general turn editor mode to the stable server profile', () => {
    assert.equal(generalTurnEditorModeStorageKey('che:default', '/che/'), 'core2026:profile:che:general-turn-editor');
    assert.equal(generalTurnEditorModeStorageKey('che:2601', '/che/'), 'core2026:profile:che:general-turn-editor');
    assert.equal(generalTurnEditorModeStorageKey('hwe:2601', '/hwe/'), 'core2026:profile:hwe:general-turn-editor');
    assert.equal(generalTurnEditorModeStorageKey(undefined, '/nya/'), 'core2026:profile:nya:general-turn-editor');
});

const rows = ['A', 'B', 'A', 'C', '휴식', '휴식'].map((action, index) => ({
    index,
    action,
    args: action === 'A' ? { value: 1 } : {},
    label: action,
}));

void test('keeps the Ref selection fallback and periodic range rules', () => {
    assert.deepEqual(normalizedSelection(new Set(), new Set([3, 1]), 6), [1, 3]);
    assert.deepEqual([...selectStep(8, 1, 3)], [1, 4, 7]);
});

void test('extracts a relative pattern and repeats it from selected anchors', () => {
    const pattern = extractPattern(rows, [0, 1, 2]);
    assert.deepEqual(pattern, [
        { turnList: [0, 2], action: 'A', args: { value: 1 }, label: 'A' },
        { turnList: [1], action: 'B', args: {}, label: 'B' },
    ]);
    assert.deepEqual(amplifyPattern(pattern, [0, 3], 6), [
        { turnList: [0, 3, 2, 5], action: 'A', args: { value: 1 }, label: 'A' },
        { turnList: [1, 4], action: 'B', args: {}, label: 'B' },
    ]);
});

void test('pull and push rewrite the queue with rest at the opened range', () => {
    assert.deepEqual(
        moveQueueRange(rows, [1, 2], 'pull').map((entry) => entry.action),
        ['A', 'C', '휴식', '휴식', '휴식', '휴식']
    );
    assert.deepEqual(
        moveQueueRange(rows, [1, 2], 'push').map((entry) => entry.action),
        ['A', '휴식', '휴식', 'B', 'A', 'C']
    );
});
