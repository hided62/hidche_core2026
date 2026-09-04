import type { City, MapDefinition } from '@sammo-ts/logic';

import { LARGE_TEST_MAP } from './largeTestMap.js';

const COMPACT_CITY_IDS = new Set([1, 2, 3, 4, 5]);

export const COMPACT_NPC_TEST_MAP: MapDefinition = {
    id: 'compact_npc_test_map',
    name: 'NPC 장기 시뮬레이션용 소형 맵',
    cities: LARGE_TEST_MAP.cities
        .filter((city) => COMPACT_CITY_IDS.has(city.id))
        .map((city) => ({
            ...city,
            connections: city.connections.filter((cityId) => COMPACT_CITY_IDS.has(cityId)),
        })),
    defaults: { ...LARGE_TEST_MAP.defaults },
};

export const buildCompactNpcTestCities = (): City[] =>
    COMPACT_NPC_TEST_MAP.cities.map((city) => ({
        id: city.id,
        name: city.name,
        nationId: 0,
        level: city.level,
        state: 0,
        population: city.initial.population,
        populationMax: city.max.population,
        agriculture: city.initial.agriculture,
        agricultureMax: city.max.agriculture,
        commerce: city.initial.commerce,
        commerceMax: city.max.commerce,
        security: city.initial.security,
        securityMax: city.max.security,
        supplyState: 1,
        frontState: 0,
        defence: city.initial.defence,
        defenceMax: city.max.defence,
        wall: city.initial.wall,
        wallMax: city.max.wall,
        meta: { trust: 95 },
    }));
