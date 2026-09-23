import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    aidLevelTable,
    counterStrategyOption,
    scoutMessageRows,
} from '../src/components/command/commandNationDetails.ts';

void test('aid level table follows Ref levelInfo: every level × coefAidAmount with the current level marked', () => {
    assert.deepEqual(
        aidLevelTable(3).map((row) => [row.text, row.amount, row.current]),
        [
            ['방랑군', 0, false],
            ['호족', 10_000, false],
            ['군벌', 20_000, false],
            ['주자사', 30_000, true],
            ['주목', 40_000, false],
            ['공', 50_000, false],
            ['왕', 60_000, false],
            ['황제', 70_000, false],
        ]
    );
    assert.equal(
        aidLevelTable(undefined).some((row) => row.current),
        false
    );
});

void test('scout rows keep nation order, prepend 재야 only for 장수대상임관 and select only for 임관', () => {
    const messages = [
        { nationId: 2, name: '위', color: '#0000FF', message: '<p>위</p>' },
        { nationId: 1, name: '촉', color: '#FFFF00', message: '' },
    ];
    const join = scoutMessageRows('che_임관', messages);
    assert.deepEqual(
        join.map((row) => [row.nationId, row.name, row.textColor, row.selectable]),
        [
            [2, '위', '#FFFFFF', true],
            [1, '촉', '#000000', true],
        ]
    );
    const follow = scoutMessageRows('che_장수대상임관', messages);
    assert.deepEqual(
        follow.map((row) => [row.nationId, row.name, row.color, row.message, row.selectable]),
        [
            [0, '재야', '#000000', '', false],
            [2, '위', '#0000FF', '<p>위</p>', false],
            [1, '촉', '#FFFF00', '', false],
        ]
    );
    assert.deepEqual(scoutMessageRows('che_등용', messages), []);
    assert.deepEqual(scoutMessageRows('che_임관', undefined), []);
});

void test('counter strategy options show Ref remaining turns', () => {
    const option = { value: 'che_수몰', label: '수몰' };
    assert.deepEqual(counterStrategyOption(option, { che_수몰: 12 }), { label: '수몰 (불가, 12턴)', remainTurn: 12 });
    assert.deepEqual(counterStrategyOption(option, { che_허보: 3 }), { label: '수몰', remainTurn: 0 });
    assert.deepEqual(counterStrategyOption(option, undefined), { label: '수몰', remainTurn: 0 });
});
