import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    buildCommandTargetSearchIndex,
    buildCommandOptionSearchIndex,
    matchesCommandTargetSearch,
} from '../src/utils/commandTargetSearch.ts';

void test('Ref name index includes keyboard initials and both IME compound levels', () => {
    assert.deepEqual(buildCommandTargetSearchIndex('강서'), ['강서', 'rt', 'ㄱㅅ', 'ㄳ']);
    assert.deepEqual(buildCommandTargetSearchIndex('사서'), ['사서', 'tt', 'ㅅㅅ', 'ㅆ']);
    assert.deepEqual(buildCommandTargetSearchIndex('강서사서'), ['강서사서', 'rttt', 'ㄱㅅㅅㅅ', 'ㄳㅅㅅ', 'ㄳㅆ']);
});

void test('literal, initial, keyboard and normalized queries preserve meaningful distinctions', () => {
    const index = buildCommandTargetSearchIndex('허창 (적국)');
    for (const query of ['', '  ', '허창', 'ㅎㅊ', 'GC', '허 창', '적국', 'ㅈㄱ']) {
        assert.equal(matchesCommandTargetSearch(index, query), true, query);
    }
    for (const query of ['업', 'ㅎㄱ', '.*', '[']) assert.equal(matchesCommandTargetSearch(index, query), false, query);
    assert.equal(matchesCommandTargetSearch(buildCommandTargetSearchIndex('관우'), '관우'), true);
    assert.equal(matchesCommandTargetSearch(buildCommandTargetSearchIndex('여포NPC'), 'npc'), true);
    assert.equal(matchesCommandTargetSearch(buildCommandTargetSearchIndex('쌍성'), 'ㅆㅅ'), true);
    assert.equal(matchesCommandTargetSearch(buildCommandTargetSearchIndex('쌍성'), 'ㅅㅅ'), false);
});

void test('explicit names exclude descriptive copy and placeholders without blacklisting genuine names', () => {
    const option = {
        label: '관우 (무소속 · 재야)',
        targetNames: { name: '관우', troopName: '청룡대', nationName: null, cityName: null },
        description: '탑승 부대 없음 · 현재 불가 · 금 100',
    };
    const index = buildCommandOptionSearchIndex(option);
    for (const query of ['ㅇㅇ', '없음', '무소속', '재야', '현재', '100'])
        assert.equal(matchesCommandTargetSearch(index, query), false, query);
    for (const query of ['관우', 'ㄱㅇ', '청룡대', 'ㅊㄹㄷ'])
        assert.equal(matchesCommandTargetSearch(index, query), true, query);
    assert.equal(
        matchesCommandTargetSearch(
            buildCommandOptionSearchIndex({ label: '별명', targetNames: { name: '없음', troopName: null } }),
            'ㅇㅇ'
        ),
        true
    );
    assert.equal(
        matchesCommandTargetSearch(
            buildCommandOptionSearchIndex({ label: '관우', ...{ description: '부대 없음' } }),
            'ㅇㅇ'
        ),
        false
    );
    assert.deepEqual(
        buildCommandOptionSearchIndex({ label: '누락 안내', targetNames: { name: '', troopName: null } }),
        []
    );
});
