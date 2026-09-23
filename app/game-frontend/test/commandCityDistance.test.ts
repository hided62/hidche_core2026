import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { COMMAND_CITY_DISTANCE_RANGE, citiesBasedOnDistance } from '../src/components/command/commandCityDistance.ts';

type MapDefinition = { cities: Array<{ id: number; connections: number[] }> };

const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;

// Ref `hwe/func.php` searchDistance와 `func_legacy.php` JSCitiesBasedOnDistance 원문을
// che 지도 CityConst로 실행한 결과(2026-09-23, 생성 절차는 report 참고)다.
const refDistances = readJson<Record<string, Record<string, number[]>>>(
    './fixtures/ref-cities-based-on-distance-che.json'
);
const cheMap = readJson<MapDefinition>('../../../resources/map/map_che.json');
const cityList = cheMap.cities.map((city) => ({ id: city.id, path: city.connections }));

void test('matches Ref JSCitiesBasedOnDistance order for every che city up to 3 distance', () => {
    assert.equal(Object.keys(refDistances).length, cityList.length);
    for (const city of cityList) {
        const expected = refDistances[String(city.id)];
        assert.ok(expected, `Ref fixture has city ${city.id}`);
        const actual = citiesBasedOnDistance(city.id, cityList, 3);
        assert.deepEqual(
            Object.fromEntries(actual.map((group) => [String(group.distance), group.cityIds])),
            expected,
            `city ${city.id}`
        );
        assert.deepEqual(citiesBasedOnDistance(city.id, cityList, 1), [{ distance: 1, cityIds: expected['1'] }]);
    }
});

void test('keeps empty distance rows like Ref when the graph ends early', () => {
    const tiny = [
        { id: 1, path: [2] },
        { id: 2, path: [1] },
    ];
    assert.deepEqual(citiesBasedOnDistance(1, tiny, 3), [
        { distance: 1, cityIds: [2] },
        { distance: 2, cityIds: [] },
        { distance: 3, cityIds: [] },
    ]);
    assert.deepEqual(citiesBasedOnDistance(99, tiny, 1), [{ distance: 1, cityIds: [] }]);
});

void test('uses the Ref ProcessCity distance for each general city command', () => {
    assert.deepEqual(COMMAND_CITY_DISTANCE_RANGE, {
        che_이동: 1,
        che_출병: 1,
        che_강행: 3,
        che_첩보: 3,
        che_화계: 3,
        che_탈취: 3,
        che_파괴: 3,
        che_선동: 3,
    });
    for (const nationCommand of ['che_천도', 'che_수몰', 'che_허보', 'che_초토화', 'che_백성동원', 'che_발령']) {
        assert.equal(Object.hasOwn(COMMAND_CITY_DISTANCE_RANGE, nationCommand), false);
    }
});
