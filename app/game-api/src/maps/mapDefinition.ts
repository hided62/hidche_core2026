import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { MapDefinitionSchema, type MapDefinition } from '@sammo-ts/logic';

const resolveWorkspaceRoot = (): string => {
    let current = path.resolve(process.cwd());
    for (let depth = 0; depth <= 6; depth += 1) {
        if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return path.resolve(process.cwd());
};

const RESOURCE_MAP_ROOT = path.resolve(resolveWorkspaceRoot(), 'resources/map');
const mapCache = new Map<string, MapDefinition>();

export const loadMapDefinitionByName = async (mapName: string): Promise<MapDefinition> => {
    if (!/^[a-zA-Z0-9_-]+$/.test(mapName)) {
        throw new Error(`Invalid map name: ${mapName}`);
    }
    const cached = mapCache.get(mapName);
    if (cached) {
        return cached;
    }
    const raw = await fs.readFile(path.join(RESOURCE_MAP_ROOT, `map_${mapName}.json`), 'utf-8');
    const map = MapDefinitionSchema.parse(JSON.parse(raw));
    mapCache.set(mapName, map);
    return map;
};
