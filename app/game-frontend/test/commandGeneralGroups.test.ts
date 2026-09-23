import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    groupGeneralOptionsByNation,
    NATION_GROUPED_GENERAL_COMMANDS,
} from '../src/components/command/commandGeneralGroups.ts';

const nations = [
    { value: 1, label: '위', color: '#FFD700' },
    { value: 2, label: '오', color: '#000080' },
];

void test('groups general options by nation in first-appearance order like Ref SelectGeneral', () => {
    const groups = groupGeneralOptionsByNation(
        [
            { value: 11, label: '가 (오)', nationId: 2 },
            { value: 12, label: '나 (재야)', nationId: 0 },
            { value: 13, label: '다 (위)', nationId: 1 },
            { value: 14, label: '라 (오)', nationId: 2 },
            { value: 15, label: '마 (위)', nationId: 1, npcState: 1 },
        ],
        nations
    );
    assert.deepEqual(
        groups.map((group) => [group.name, group.color, group.textColor, group.options.map((option) => option.value)]),
        [
            ['오', '#000080', '#FFFFFF', [11, 14]],
            ['재야', '#000000', '#FFFFFF', [12]],
            ['위', '#FFD700', '#000000', [13, 15]],
        ]
    );
});

void test('falls back to the option nation name and the wanderer color for unknown nations', () => {
    const [group] = groupGeneralOptionsByNation(
        [{ value: 1, label: '가', nationId: 9, targetNames: { name: '가', nationName: '멸망국' } }],
        nations
    );
    assert.deepEqual([group?.name, group?.color], ['멸망국', '#000000']);
    assert.deepEqual(groupGeneralOptionsByNation([], nations), []);
});

void test('only Ref groupByNation commands are grouped', () => {
    assert.deepEqual([...NATION_GROUPED_GENERAL_COMMANDS], ['che_등용', 'che_장수대상임관']);
});
