import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    DISPLAY_SETTINGS_VERSION,
    compareGridValues,
    defaultNationGeneralDisplaySettings,
    matchesKoreanSearch,
    matchesNumberFilterCondition,
    matchesNumberSearch,
    matchesTextFilterCondition,
    numberFilterOperators,
    parseStoredDisplaySettings,
    parseStoredSettingKey,
    serializeDisplaySettings,
    textFilterOperators,
} from '../src/utils/nationGeneralGrid.ts';

void describe('nation general Ref-compatible grid state', () => {
    void it('keeps the Ref default group and sort state', () => {
        const normal = defaultNationGeneralDisplaySettings.normal;
        assert.equal(normal.columnGroup.find((entry) => entry.groupId === 'stat')?.open, true);
        assert.equal(normal.columnGroup.find((entry) => entry.groupId === 'specials')?.open, false);
        assert.equal(normal.column.find((entry) => entry.colId === 'age')?.hide, false);
        assert.equal(normal.column.find((entry) => entry.colId === 'reservedCommand')?.hide, true);
        assert.deepEqual(
            normal.column.filter((entry) => entry.sort).map((entry) => [entry.colId, entry.sort, entry.sortIndex]),
            [['refreshScoreTotal', 'desc', 0]]
        );
        const war = defaultNationGeneralDisplaySettings.war;
        assert.equal(war.columnGroup.find((entry) => entry.groupId === 'stat')?.open, false);
        assert.equal(war.column.find((entry) => entry.colId === 'stat_1')?.hide, false);
        assert.equal(war.column.find((entry) => entry.colId === 'leadership')?.hide, false);
        assert.equal(war.column.find((entry) => entry.colId === 'crewtypeAndCrew_1')?.hide, false);
        assert.equal(war.column.find((entry) => entry.colId === 'reservedCommand')?.hide, false);
        assert.equal(war.column.find((entry) => entry.colId === 'turntime')?.sort, 'asc');
    });

    void it('round-trips named settings and rejects invalid versions', () => {
        const settings = new Map([['전투 보기', defaultNationGeneralDisplaySettings.war]]);
        const restored = parseStoredDisplaySettings(serializeDisplaySettings(settings));
        assert.equal(restored.get('전투 보기')?.column.find((entry) => entry.colId === 'icon')?.hide, true);
        assert.deepEqual(
            parseStoredDisplaySettings(JSON.stringify({ version: DISPLAY_SETTINGS_VERSION + 1, settings: [] })),
            new Map()
        );
        assert.deepEqual(parseStoredDisplaySettings('{broken'), new Map());
    });

    void it('accepts only valid last-used setting tuples', () => {
        assert.deepEqual(parseStoredSettingKey('[true,"normal"]'), [true, 'normal']);
        assert.deepEqual(parseStoredSettingKey('[false,"내 설정"]'), [false, '내 설정']);
        assert.equal(parseStoredSettingKey('[true,"missing"]'), null);
    });

    void it('matches Korean names by text and initial consonants', () => {
        assert.equal(matchesKoreanSearch('테스트장수', '테스트'), true);
        assert.equal(matchesKoreanSearch('테스트장수', 'ㅌㅅㅌㅈㅅ'), true);
        assert.equal(matchesKoreanSearch('테스트장수', 'ㄱㄴ'), false);
    });

    void it('uses Ref-like numeric comparisons and stable Korean text ordering', () => {
        assert.equal(matchesNumberSearch(90, '90'), true);
        assert.equal(matchesNumberSearch(90, '>= 80'), true);
        assert.equal(matchesNumberSearch(90, '< 80'), false);
        assert.equal(compareGridValues(10, 2) > 0, true);
        assert.equal(compareGridValues(null, 2) > 0, true);
        assert.equal(compareGridValues('가', '나') < 0, true);
    });

    void it('exposes the Ref text and number filter menus in the same order', () => {
        assert.deepEqual(
            textFilterOperators.map((operator) => operator.label),
            ['Contains', 'Not contains', 'Equals', 'Not equal', 'Starts with', 'Ends with', 'Blank', 'Not blank']
        );
        assert.deepEqual(
            numberFilterOperators.map((operator) => operator.label),
            [
                'Equals',
                'Not equal',
                'Less than',
                'Less than or equals',
                'Greater than',
                'Greater than or equals',
                'In range',
                'Blank',
                'Not blank',
            ]
        );
    });

    void it('applies Ref text operators to Korean text and initial consonants', () => {
        assert.equal(
            matchesTextFilterCondition('테스트장수', { operator: 'contains', value: 'ㅌㅅㅌ', valueTo: '' }),
            true
        );
        assert.equal(
            matchesTextFilterCondition('테스트장수', { operator: 'notContains', value: '다른', valueTo: '' }),
            true
        );
        assert.equal(
            matchesTextFilterCondition('테스트장수', { operator: 'startsWith', value: 'ㅌㅅ', valueTo: '' }),
            true
        );
        assert.equal(matchesTextFilterCondition('', { operator: 'blank', value: '', valueTo: '' }), true);
        assert.equal(matchesTextFilterCondition('장수', { operator: 'notBlank', value: '', valueTo: '' }), true);
    });

    void it('applies Ref number comparison, range, and blank operators', () => {
        assert.equal(
            matchesNumberFilterCondition(70, { operator: 'greaterThanOrEqual', value: '60', valueTo: '' }),
            true
        );
        assert.equal(matchesNumberFilterCondition(70, { operator: 'inRange', value: '65', valueTo: '75' }), true);
        assert.equal(matchesNumberFilterCondition(40, { operator: 'inRange', value: '65', valueTo: '75' }), false);
        assert.equal(matchesNumberFilterCondition(null, { operator: 'blank', value: '', valueTo: '' }), true);
        assert.equal(matchesNumberFilterCondition(0, { operator: 'notBlank', value: '', valueTo: '' }), true);
    });
});
