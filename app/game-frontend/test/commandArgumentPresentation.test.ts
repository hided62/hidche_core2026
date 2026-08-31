import assert from 'node:assert/strict';
import test from 'node:test';

import {
    commandArgumentPresentation,
    presentedCommandKeys,
    resolveCommandArgumentMapTarget,
} from '../src/components/command/commandArgumentPresentation.ts';

const cityCommands = [
    'che_강행',
    'che_이동',
    'che_출병',
    'che_첩보',
    'che_화계',
    'che_탈취',
    'che_파괴',
    'che_선동',
    'che_수몰',
    'che_백성동원',
    'che_천도',
    'che_허보',
    'che_초토화',
    'cr_인구이동',
    'che_발령',
];

const nationCommands = [
    'che_선전포고',
    'che_급습',
    'che_불가침파기제의',
    'che_이호경식',
    'che_종전제의',
    'che_불가침제의',
    'che_피장파장',
    'che_물자원조',
];

const otherArgumentCommands = [
    'che_증여',
    'che_헌납',
    'che_군량매매',
    'che_몰수',
    'che_포상',
    'che_부대탈퇴지시',
    'che_등용',
    'che_선양',
    'che_임관',
    'che_장수대상임관',
    'che_숙련전환',
    'che_장비매매',
    'che_건국',
    'che_무작위건국',
    'cr_건국',
    'che_국기변경',
    'che_국호변경',
    'che_등용수락',
    'che_NPC능동',
];

void test('provides Ref-level guidance for every in-scope argument command', () => {
    const expected = [...cityCommands, ...nationCommands, ...otherArgumentCommands].sort();
    assert.deepEqual(presentedCommandKeys().sort(), expected);
    for (const commandKey of expected) {
        assert.ok(commandArgumentPresentation(commandKey).lines.join(' ').length >= 12, commandKey);
    }
    assert.ok(!presentedCommandKeys().includes('che_징병'));
    assert.ok(!presentedCommandKeys().includes('che_모병'));
    assert.deepEqual(commandArgumentPresentation('che_징병'), { lines: [] });
    assert.deepEqual(commandArgumentPresentation('che_모병'), { lines: [] });
});

void test('marks the same city and nation target families that Ref renders with a map', () => {
    for (const commandKey of cityCommands) {
        assert.equal(commandArgumentPresentation(commandKey).mapTarget, 'city', commandKey);
    }
    for (const commandKey of nationCommands) {
        assert.equal(commandArgumentPresentation(commandKey).mapTarget, 'nation', commandKey);
    }
});

void test('derives selection maps from the actual city and nation argument contract', () => {
    assert.equal(
        resolveCommandArgumentMapTarget('future_city_command', [
            { key: 'target', label: '도시', kind: 'select', required: true, optionSource: 'cities' },
        ]),
        'city'
    );
    assert.equal(
        resolveCommandArgumentMapTarget('future_nation_command', [
            { key: 'target', label: '국가', kind: 'select', required: true, optionSource: 'nations' },
        ]),
        'nation'
    );
    assert.equal(resolveCommandArgumentMapTarget('che_증축', []), undefined);
    assert.equal(
        resolveCommandArgumentMapTarget('future_general_command', [
            { key: 'target', label: '장수', kind: 'select', required: true, optionSource: 'generals' },
        ]),
        undefined
    );
});
