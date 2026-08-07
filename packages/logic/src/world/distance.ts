import type { City } from '@sammo-ts/logic/domain/entities.js';
import type { MapDefinition } from '@sammo-ts/logic/world/types.js';

const buildConnectionMap = (map: MapDefinition): Map<number, number[]> => {
    const result = new Map<number, number[]>();
    for (const city of map.cities) {
        result.set(city.id, city.connections ?? []);
    }
    return result;
};

export const searchAllDistanceByCityList = (
    map: MapDefinition,
    cityIds: number[]
): Record<number, Record<number, number>> => {
    if (cityIds.length === 0) {
        return {};
    }
    const connectionMap = buildConnectionMap(map);
    const citySet = new Set(cityIds);
    const result: Record<number, Record<number, number>> = {};

    for (const startId of citySet) {
        const distances: Record<number, number> = { [startId]: 0 };
        const queue: Array<[number, number]> = [[startId, 0]];

        while (queue.length > 0) {
            const [currentId, dist] = queue.shift()!;
            const connections = connectionMap.get(currentId) ?? [];
            for (const nextId of connections) {
                if (!citySet.has(nextId) || distances[nextId] !== undefined) {
                    continue;
                }
                distances[nextId] = dist + 1;
                queue.push([nextId, dist + 1]);
            }
        }

        result[startId] = distances;
    }

    return result;
};

export const searchAllDistanceByNationList = (
    map: MapDefinition,
    cities: City[],
    nationIds: number[],
    suppliedCityOnly: boolean
): Record<number, Record<number, number>> => {
    if (nationIds.length === 0) {
        return {};
    }
    const cityIds = cities
        .filter((city) => nationIds.includes(city.nationId))
        .filter((city) => !suppliedCityOnly || city.supplyState > 0)
        .map((city) => city.id);
    return searchAllDistanceByCityList(map, cityIds);
};

export const isNeighbor = (
    map: MapDefinition,
    cities: City[],
    nationA: number,
    nationB: number,
    includeNoSupply = true
): boolean => {
    if (nationA === nationB) {
        return false;
    }
    const connectionMap = buildConnectionMap(map);
    const nationACities = new Set(
        cities
            .filter((city) => city.nationId === nationA)
            .filter((city) => includeNoSupply || city.supplyState > 0)
            .map((city) => city.id)
    );

    const nationBCities = cities
        .filter((city) => city.nationId === nationB)
        .filter((city) => includeNoSupply || city.supplyState > 0)
        .map((city) => city.id);

    for (const cityId of nationBCities) {
        for (const adjacentId of connectionMap.get(cityId) ?? []) {
            if (nationACities.has(adjacentId)) {
                return true;
            }
        }
    }

    return false;
};

export const getCityDistance = (map: MapDefinition, startCityId: number, endCityId: number): number => {
    if (startCityId === endCityId) return 0;

    const visited = new Set<number>();
    const queue: [number, number][] = [[startCityId, 0]]; // [cityId, distance]
    visited.add(startCityId);

    while (queue.length > 0) {
        const [currentId, dist] = queue.shift()!;

        const cityDef = map.cities.find((c) => c.id === currentId);
        if (!cityDef) continue;

        for (const neighborId of cityDef.connections) {
            if (neighborId === endCityId) {
                return dist + 1;
            }
            if (!visited.has(neighborId)) {
                visited.add(neighborId);
                queue.push([neighborId, dist + 1]);
            }
        }
    }

    return Infinity;
};

export const searchDistanceEntries = (
    map: MapDefinition,
    startCityId: number,
    range: number
): Array<[cityId: number, distance: number]> => {
    const result: Array<[number, number]> = [];
    const visited = new Set<number>();
    const queue: [number, number][] = [[startCityId, 0]];

    visited.add(startCityId);

    while (queue.length > 0) {
        const [currentId, dist] = queue.shift()!;
        result.push([currentId, dist]);

        if (dist >= range) continue;

        const cityDef = map.cities.find((c) => c.id === currentId);
        if (!cityDef) continue;

        for (const neighborId of cityDef.connections) {
            if (!visited.has(neighborId)) {
                visited.add(neighborId);
                const newDist = dist + 1;
                queue.push([neighborId, newDist]);
            }
        }
    }

    return result;
};

export const searchDistance = (map: MapDefinition, startCityId: number, range: number): Record<number, number> =>
    Object.fromEntries(searchDistanceEntries(map, startCityId, range));
