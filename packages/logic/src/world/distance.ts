import type { MapDefinition } from '@sammo-ts/logic/world/types.js';

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
