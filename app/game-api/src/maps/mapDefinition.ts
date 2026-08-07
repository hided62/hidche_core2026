import { loadMapDefinitionByName as loadRuntimeMapDefinitionByName } from '@sammo-ts/game-engine/scenario/mapLoader.js';
import type { MapDefinition } from '@sammo-ts/logic';

const mapCache = new Map<string, MapDefinition>();

export const loadMapDefinitionByName = async (mapName: string): Promise<MapDefinition> => {
    if (!/^[a-zA-Z0-9_-]+$/.test(mapName)) {
        throw new Error(`Invalid map name: ${mapName}`);
    }
    const cached = mapCache.get(mapName);
    if (cached) {
        return cached;
    }
    const map = await loadRuntimeMapDefinitionByName(mapName);
    mapCache.set(mapName, map);
    return map;
};
