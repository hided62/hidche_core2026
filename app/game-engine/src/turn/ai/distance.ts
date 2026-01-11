import type { City, MapDefinition } from '@sammo-ts/logic';

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
                if (!citySet.has(nextId)) {
                    continue;
                }
                if (distances[nextId] !== undefined) {
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
        const connections = connectionMap.get(cityId) ?? [];
        for (const adjId of connections) {
            if (nationACities.has(adjId)) {
                return true;
            }
        }
    }

    return false;
};
