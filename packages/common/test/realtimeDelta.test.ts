import { describe, expect, it } from 'vitest';

import { applyReadModelDelta, ReadModelDeltaMismatchError } from '../src/realtime/delta.js';

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
});
