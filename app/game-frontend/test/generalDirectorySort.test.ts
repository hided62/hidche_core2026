import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    advanceGeneralDirectorySort,
    sortGeneralDirectory,
    type GeneralDirectorySortable,
} from '../src/utils/generalDirectorySort.ts';

type Row = GeneralDirectorySortable & { id: number };

const row = (id: number, name: string, leadership: number, strength: number): Row => ({
    id,
    name,
    nationId: id,
    leadership,
    strength,
    intelligence: 0,
    experience: 0,
    dedication: 0,
    officerLevel: 0,
    killturn: 0,
    refreshScoreTotal: 0,
    personality: { key: '' },
    specialDomestic: { key: '' },
    specialWar: { key: '' },
    age: 0,
    npcState: 0,
});

void describe('general directory client sorting', () => {
    void it('cycles each column through descending, ascending, and reset', () => {
        const descending = advanceGeneralDirectorySort([], 2);
        assert.deepEqual(descending, [{ key: 2, direction: 'descending' }]);
        const ascending = advanceGeneralDirectorySort(descending, 2);
        assert.deepEqual(ascending, [{ key: 2, direction: 'ascending' }]);
        assert.deepEqual(advanceGeneralDirectorySort(ascending, 2), []);
    });

    void it('keeps the previous descending key as a tie-breaker for a later ascending key', () => {
        const source = [row(1, '갑', 70, 20), row(2, '을', 90, 20), row(3, '병', 80, 10)];
        const leadership = advanceGeneralDirectorySort([], 2);
        const strengthDescending = advanceGeneralDirectorySort(leadership, 3);
        const strengthAscending = advanceGeneralDirectorySort(strengthDescending, 3);

        assert.deepEqual(
            sortGeneralDirectory(source, strengthAscending).map(({ id }) => id),
            [3, 2, 1]
        );
    });

    void it('removes only the reset column and restores the older stable ordering', () => {
        const source = [row(1, '갑', 70, 20), row(2, '을', 90, 20), row(3, '병', 80, 10)];
        const leadership = advanceGeneralDirectorySort([], 2);
        const strengthDescending = advanceGeneralDirectorySort(leadership, 3);
        const strengthAscending = advanceGeneralDirectorySort(strengthDescending, 3);
        const resetStrength = advanceGeneralDirectorySort(strengthAscending, 3);

        assert.deepEqual(resetStrength, leadership);
        assert.deepEqual(
            sortGeneralDirectory(source, resetStrength).map(({ id }) => id),
            [2, 3, 1]
        );
    });

    void it('sorts Korean names in both directions without mutating the source', () => {
        const source = [row(1, '조조', 0, 0), row(2, '가후', 0, 0), row(3, '유비', 0, 0)];
        const descending = advanceGeneralDirectorySort([], 0);
        const ascending = advanceGeneralDirectorySort(descending, 0);

        assert.deepEqual(
            sortGeneralDirectory(source, descending).map(({ name }) => name),
            ['조조', '유비', '가후']
        );
        assert.deepEqual(
            sortGeneralDirectory(source, ascending).map(({ name }) => name),
            ['가후', '유비', '조조']
        );
        assert.deepEqual(
            source.map(({ id }) => id),
            [1, 2, 3]
        );
    });
});
