import fs from 'node:fs/promises';
import path from 'node:path';

import { MapDefinitionSchema, RegionMapSchema, type MapDefinition } from '@sammo-ts/logic';

import { resolveWorkspaceRoot } from '../paths.js';

const REPO_ROOT = resolveWorkspaceRoot();
const DEFAULT_MAP_ROOT = path.resolve(REPO_ROOT, 'resources', 'map');
const DEFAULT_REGION_MAP_PATH = path.resolve(DEFAULT_MAP_ROOT, 'region_map.json');

export interface MapLoaderOptions {
    mapRoot?: string;
    filePrefix?: string;
}

export interface RegionMapLoaderOptions {
    regionMapPath?: string;
}

const readJsonFile = async (filePath: string): Promise<unknown> => {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
};

const resolveMapRoot = (options?: MapLoaderOptions): string => options?.mapRoot ?? DEFAULT_MAP_ROOT;

const resolveMapDefinitionPath = (mapName: string, options?: MapLoaderOptions): string => {
    const prefix = options?.filePrefix ?? 'map_';
    return path.resolve(resolveMapRoot(options), `${prefix}${mapName}.json`);
};

const loadMapDefinition = async (mapPath: string): Promise<MapDefinition> => {
    const raw = await readJsonFile(mapPath);
    return MapDefinitionSchema.parse(raw);
};

export const loadMapDefinitionByName = async (mapName: string, options?: MapLoaderOptions): Promise<MapDefinition> => {
    const mapPath = resolveMapDefinitionPath(mapName, options);
    return loadMapDefinition(mapPath);
};

export const loadRegionDisplayMapByName = async (
    mapName: string,
    options?: RegionMapLoaderOptions
): Promise<Record<number, string>> => {
    const raw = await readJsonFile(options?.regionMapPath ?? DEFAULT_REGION_MAP_PATH);
    const regionMaps = RegionMapSchema.parse(raw);
    const selected = regionMaps[mapName] ?? {};
    return Object.fromEntries(
        Object.entries(selected)
            .map(([key, value]) => [Number(key), value] as const)
            .filter(([key]) => Number.isSafeInteger(key))
    );
};
