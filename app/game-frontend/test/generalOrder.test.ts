import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareGeneralTypeThenName, sortGeneralsByTypeThenName } from '../src/utils/generalOrder.ts';

void describe('general display order', () => {
    void it('orders general types before Korean names and ids', () => {
        const source = [
            { id: 8, name: '㉥부대장', npcState: 5 },
            { id: 7, name: 'ⓖ의병장', npcState: 4 },
            { id: 6, name: 'ⓜ마초', npcState: 3 },
            { id: 5, name: 'ⓝ조조', npcState: 2 },
            { id: 4, name: 'ⓝ빙의장', npcState: 1 },
            { id: 3, name: '하후돈', npcState: 0 },
            { id: 2, name: '가후', npcState: 0 },
            { id: 1, name: '가후', npcState: 0 },
        ];

        assert.deepEqual(
            sortGeneralsByTypeThenName(source).map((general) => general.id),
            [1, 2, 3, 4, 5, 6, 7, 8]
        );
        assert.deepEqual(
            source.map((general) => general.id),
            [8, 7, 6, 5, 4, 3, 2, 1]
        );
    });

    void it('keeps later special NPC types in their persisted numeric order', () => {
        assert.deepEqual(
            [
                { id: 9, name: 'ⓞ오랑캐', npcState: 9 },
                { id: 6, name: 'ⓤ중립장', npcState: 6 },
            ]
                .sort(compareGeneralTypeThenName)
                .map((general) => general.npcState),
            [6, 9]
        );
    });
});
