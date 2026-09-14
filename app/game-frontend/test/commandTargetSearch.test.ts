import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCommandTargetSearchIndex, matchesCommandTargetSearch } from '../src/utils/commandTargetSearch.ts';

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
