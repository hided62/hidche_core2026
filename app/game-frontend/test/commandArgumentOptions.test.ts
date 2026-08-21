import assert from 'node:assert/strict';
import test from 'node:test';

import { commandCityOptions } from '../src/components/command/commandArgumentOptions.ts';
import type { CommandMapData, CommandOption } from '../src/components/command/types.ts';

const cities: CommandOption[] = [
    { value: 20, label: '적국 도시' },
    { value: 30, label: '아국 도시 둘' },
    { value: 40, label: '공백지' },
    { value: 10, label: '아국 도시 하나' },
];
const mapData: CommandMapData = {
    year: 200,
    month: 1,
    startYear: 180,
    cityList: [
        [10, 8, 0, 1, 1, 1],
        [20, 7, 0, 2, 2, 1],
        [30, 6, 0, 1, 3, 1],
        [40, 5, 0, 0, 4, 1],
    ],
    nationList: [
        [1, '아국', '#008000', 10],
        [2, '적국', '#800000', 20],
    ],
    myCity: 10,
    myNation: 1,
};

void test('발령은 아국 도시를 먼저 두고 적국과 공백지를 원래 순서로 보존한다', () => {
    const sorted = commandCityOptions('che_발령', cities, mapData);

    assert.deepEqual(
        sorted.map((option) => option.value),
        [30, 10, 20, 40]
    );
    assert.deepEqual(
        cities.map((option) => option.value),
        [20, 30, 40, 10],
        '공용 입력 option은 변경하지 않는다'
    );
});

void test('다른 도시 대상 명령의 순서는 바꾸지 않는다', () => {
    assert.deepEqual(
        commandCityOptions('che_출병', cities, mapData).map((option) => option.value),
        [20, 30, 40, 10]
    );
});

void test('지도 국가 정보가 아직 없으면 발령의 기존 option 순서를 유지한다', () => {
    assert.deepEqual(
        commandCityOptions('che_발령', cities, null).map((option) => option.value),
        [20, 30, 40, 10]
    );
});
