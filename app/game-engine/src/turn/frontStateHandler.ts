import type { City, MapDefinition, Nation } from '@sammo-ts/logic';
import type { InMemoryTurnWorld, TurnCalendarHandler } from './inMemoryWorld.js';
import type { TurnDiplomacy } from './types.js';

type ConnectionMap = Map<number, number[]>;

const buildConnectionMap = (map: MapDefinition): ConnectionMap => {
    const connectionMap = new Map<number, number[]>();
    for (const city of map.cities) {
        connectionMap.set(city.id, city.connections ?? []);
    }
    return connectionMap;
};

const collectAdjacentCities = (cityIds: number[], connectionMap: ConnectionMap, bucket: Set<number>): void => {
    for (const cityId of cityIds) {
        const neighbors = connectionMap.get(cityId) ?? [];
        for (const neighborId of neighbors) {
            bucket.add(neighborId);
        }
    }
};

const collectNationCityIds = (cities: City[]): Map<number, number[]> => {
    const map = new Map<number, number[]>();
    for (const city of cities) {
        const list = map.get(city.nationId) ?? [];
        list.push(city.id);
        map.set(city.nationId, list);
    }
    return map;
};

const collectDiplomacyTargets = (entries: TurnDiplomacy[], nationId: number): {
    warTargets: number[];
    declareTargets: number[];
} => {
    const warTargets: number[] = [];
    const declareTargets: number[] = [];
    for (const entry of entries) {
        if (entry.fromNationId !== nationId) {
            continue;
        }
        if (entry.state === 0) {
            warTargets.push(entry.toNationId);
        } else if (entry.state === 1 && entry.term <= 5) {
            declareTargets.push(entry.toNationId);
        }
    }
    return { warTargets, declareTargets };
};

const resolveNationFrontStates = (
    nationId: number,
    connectionMap: ConnectionMap,
    cityIdsByNation: Map<number, number[]>,
    diplomacy: TurnDiplomacy[]
): Map<number, number> => {
    const frontStates = new Map<number, number>();
    if (nationId <= 0) {
        return frontStates;
    }

    const { warTargets, declareTargets } = collectDiplomacyTargets(diplomacy, nationId);
    const adj3 = new Set<number>();
    const adj2 = new Set<number>();
    const adj1 = new Set<number>();

    for (const targetNationId of warTargets) {
        const targetCities = cityIdsByNation.get(targetNationId) ?? [];
        collectAdjacentCities(targetCities, connectionMap, adj3);
    }

    for (const targetNationId of declareTargets) {
        const targetCities = cityIdsByNation.get(targetNationId) ?? [];
        collectAdjacentCities(targetCities, connectionMap, adj1);
    }

    if (adj3.size === 0 && adj1.size === 0) {
        const neutralCities = cityIdsByNation.get(0) ?? [];
        collectAdjacentCities(neutralCities, connectionMap, adj2);
    }

    const nationCityIds = cityIdsByNation.get(nationId) ?? [];
    for (const cityId of nationCityIds) {
        let nextFrontState = 0;
        if (adj1.has(cityId)) {
            nextFrontState = 1;
        }
        if (adj2.has(cityId)) {
            nextFrontState = 2;
        }
        if (adj3.has(cityId)) {
            nextFrontState = 3;
        }
        frontStates.set(cityId, nextFrontState);
    }
    return frontStates;
};

export const buildFrontStatePatches = (options: {
    worldView: {
        listCities(): City[];
        listNations(): Nation[];
        listDiplomacy(): TurnDiplomacy[];
    };
    map: MapDefinition | null | undefined;
    nationIds?: number[];
}): Array<{ id: number; patch: Partial<City> }> => {
    if (!options.map) {
        return [];
    }
    const connectionMap = buildConnectionMap(options.map);
    if (connectionMap.size === 0) {
        return [];
    }
    const cities = options.worldView.listCities();
    const cityIdsByNation = collectNationCityIds(cities);
    const diplomacy = options.worldView.listDiplomacy();
    const cityMap = new Map<number, City>();
    for (const city of cities) {
        cityMap.set(city.id, city);
    }

    const nationList = options.nationIds
        ? options.worldView
              .listNations()
              .filter((nation) => options.nationIds?.includes(nation.id))
        : options.worldView.listNations();
    const nations = nationList.filter((nation) => nation.level > 0);
    const patches: Array<{ id: number; patch: Partial<City> }> = [];
    for (const nation of nations) {
        const frontStates = resolveNationFrontStates(nation.id, connectionMap, cityIdsByNation, diplomacy);
        for (const [cityId, nextFrontState] of frontStates) {
            const city = cityMap.get(cityId);
            if (!city || city.frontState === nextFrontState) {
                continue;
            }
            patches.push({ id: cityId, patch: { frontState: nextFrontState } });
        }
    }
    return patches;
};

export const createFrontStateHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    map: MapDefinition | null | undefined;
}): TurnCalendarHandler => {
    return {
        onMonthChanged: () => {
            const world = options.getWorld();
            if (!world) {
                return;
            }
            const patches = buildFrontStatePatches({
                worldView: world,
                map: options.map,
            });
            for (const patch of patches) {
                world.updateCity(patch.id, patch.patch);
            }
        },
    };
};
