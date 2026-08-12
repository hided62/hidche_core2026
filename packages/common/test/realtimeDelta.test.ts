import { describe, expect, it } from 'vitest';

import {
    applyReadModelDelta,
    createJsonPatch,
    ReadModelDeltaApplyError,
    ReadModelDeltaMismatchError,
} from '../src/realtime/delta.js';

describe('createJsonPatch', () => {
    it('diffs stable arrays positionally and preserves narrow field updates', () => {
        const current = {
            general: Array.from({ length: 48 }, (_, index) => ({
                key: `command-${index}`,
                possible: true,
                status: 'available',
            })),
        };
        const next = structuredClone(current);
        const changed = next.general[0];
        if (!changed) throw new Error('command fixture is empty');
        changed.possible = false;
        changed.status = 'blocked';

        const operations = createJsonPatch(current, next);

        expect(operations).toEqual([
            { op: 'replace', path: '/general/0/possible', value: false },
            { op: 'replace', path: '/general/0/status', value: 'blocked' },
        ]);
        expect(
            applyReadModelDelta(current, 'revision-1', {
                kind: 'patch',
                baseRevision: 'revision-1',
                revision: 'revision-2',
                operations,
            }).data
        ).toEqual(next);
    });

    it('resizes arrays linearly and escapes object keys as JSON Pointer tokens', () => {
        const current = { 'a/b~c': { values: [1, 2] }, removed: true };
        const next = { 'a/b~c': { values: [1, 2, 3] }, added: true };

        const operations = createJsonPatch(current, next);

        expect(operations).toEqual([
            { op: 'remove', path: '/removed' },
            { op: 'add', path: '/a~1b~0c/values/-', value: 3 },
            { op: 'add', path: '/added', value: true },
        ]);
        expect(
            applyReadModelDelta(current, 'revision-1', {
                kind: 'patch',
                baseRevision: 'revision-1',
                revision: 'revision-2',
                operations,
            }).data
        ).toEqual(next);
    });

    it('reconstructs root arrays after positional insertions and removals', () => {
        const inserted = ['new', 'first', 'second'];
        const insertionOperations = createJsonPatch(['first', 'second'], inserted);
        expect(
            applyReadModelDelta(['first', 'second'], 'revision-1', {
                kind: 'patch',
                baseRevision: 'revision-1',
                revision: 'revision-2',
                operations: insertionOperations,
            }).data
        ).toEqual(inserted);

        const removed = ['second'];
        const removalOperations = createJsonPatch(['first', 'second', 'third'], removed);
        expect(
            applyReadModelDelta(['first', 'second', 'third'], 'revision-2', {
                kind: 'patch',
                baseRevision: 'revision-2',
                revision: 'revision-3',
                operations: removalOperations,
            }).data
        ).toEqual(removed);
    });
});

describe('applyReadModelDelta', () => {
    it('applies a JSON Patch without mutating the previous snapshot', () => {
        const current = {
            general: [{ key: '휴식', possible: true, status: 'available' }],
            inputOptions: { cities: [{ value: 1, label: '업' }] },
        };

        const applied = applyReadModelDelta(current, 'revision-1', {
            kind: 'patch',
            baseRevision: 'revision-1',
            revision: 'revision-2',
            operations: [{ op: 'replace', path: '/general/0/possible', value: false }],
        });

        expect(applied).toEqual({
            revision: 'revision-2',
            data: {
                general: [{ key: '휴식', possible: false, status: 'available' }],
                inputOptions: { cities: [{ value: 1, label: '업' }] },
            },
        });
        expect(current.general[0]?.possible).toBe(true);
    });

    it('keeps the current object for an unchanged revision', () => {
        const current = { value: 1 };
        const applied = applyReadModelDelta(current, 'revision-1', {
            kind: 'unchanged',
            revision: 'revision-1',
        });

        expect(applied.data).toBe(current);
    });

    it('rejects a patch based on a different snapshot', () => {
        expect(() =>
            applyReadModelDelta({ value: 1 }, 'revision-2', {
                kind: 'patch',
                baseRevision: 'revision-1',
                revision: 'revision-3',
                operations: [{ op: 'replace', path: '/value', value: 2 }],
            })
        ).toThrow(ReadModelDeltaMismatchError);
    });

    it('unwraps nested reactive-style proxies before applying a later patch', () => {
        const proxiedStableBranch = new Proxy(
            {
                values: [{ key: '이동', possible: true, status: 'available' }],
            },
            {}
        );
        const current = {
            general: [
                { category: '일반', values: [{ key: '휴식', possible: false, status: 'blocked' }] },
                proxiedStableBranch,
            ],
        };

        expect(() => structuredClone(current)).toThrow();
        const applied = applyReadModelDelta(current, 'revision-1', {
            kind: 'patch',
            baseRevision: 'revision-1',
            revision: 'revision-2',
            operations: [{ op: 'replace', path: '/general/1/values/0/possible', value: false }],
        });

        expect(applied.data.general[1]?.values[0]?.possible).toBe(false);
        expect(applied.data.general[1]).not.toBe(proxiedStableBranch);
    });

    it('reports a non-JSON baseline as a recoverable delta application error', () => {
        const current: { value: number; self?: unknown } = { value: 1 };
        current.self = current;

        expect(() =>
            applyReadModelDelta(current, 'revision-1', {
                kind: 'patch',
                baseRevision: 'revision-1',
                revision: 'revision-2',
                operations: [{ op: 'replace', path: '/value', value: 2 }],
            })
        ).toThrow(ReadModelDeltaApplyError);
    });
});
