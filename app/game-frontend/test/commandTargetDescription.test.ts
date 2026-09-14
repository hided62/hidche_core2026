import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandTargetDescription } from '../src/utils/commandTargetDescription.ts';

void test('nullable troop names receive display-only fallbacks and preserve leader and member information', () => {
    const base = { value: 1, label: '관우', description: '금 100', targetNames: { name: '관우', troopName: null } };
    assert.equal(commandTargetDescription('che_증여', base), '금 100 · 탑승 부대 없음');
    assert.equal(commandTargetDescription('che_발령', base), '탑승 부대 없음\n금 100');
    assert.equal(commandTargetDescription('che_포상', base), '금 100');
    assert.equal(commandTargetDescription('che_몰수', base), '금 100');
    assert.equal(commandTargetDescription('che_증여', { ...base, troopId: 99 }), '금 100 · 탑승 부대 #99');
    assert.equal(
        commandTargetDescription('che_증여', {
            ...base,
            troopId: 1,
            targetNames: { name: '관우', troopName: '청룡대' },
        }),
        '금 100 · 탑승 부대 청룡대 (부대장)'
    );
    assert.equal(
        commandTargetDescription('che_증여', {
            ...base,
            targetNames: undefined,
            description: '금 100 · 탑승 부대 없음',
        }),
        '금 100 · 탑승 부대 없음'
    );
    assert.equal(commandTargetDescription('che_증여'), '');
});
