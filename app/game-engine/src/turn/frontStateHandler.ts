import { buildNationFrontStatePatches, type City, type MapDefinition, type Nation } from '@sammo-ts/logic';
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
    const nationList = options.nationIds
        ? options.worldView.listNations().filter((nation) => options.nationIds?.includes(nation.id))
        : options.worldView.listNations();
    const nationIds = nationList.filter((nation) => nation.level > 0).map((nation) => nation.id);
    return buildNationFrontStatePatches({
        cities: options.worldView.listCities(),
        diplomacy: options.worldView.listDiplomacy(),
        connections: connectionMap,
        nationIds,
    }).map((patch) => ({
        id: patch.id,
        patch: { frontState: patch.frontState },
    }));
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
