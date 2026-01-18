import fs from 'node:fs/promises';
import path from 'node:path';

import { MapDefinitionSchema, type MapDefinition } from '@sammo-ts/logic';

import { resolveWorkspaceRoot } from '../paths.js';

const REPO_ROOT = resolveWorkspaceRoot();
const DEFAULT_MAP_ROOT = path.resolve(REPO_ROOT, 'resources', 'map');

export interface MapLoaderOptions {
    mapRoot?: string;
    filePrefix?: string;
}

const readJsonFile = async (filePath: string): Promise<unknown> => {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
};

const resolveMapRoot = (options?: MapLoaderOptions): string => options?.mapRoot ?? DEFAULT_MAP_ROOT;

export const resolveMapDefinitionPath = (mapName: string, options?: MapLoaderOptions): string => {
    const prefix = options?.filePrefix ?? 'map_';
    return path.resolve(resolveMapRoot(options), `${prefix}${mapName}.json`);
};

export const loadMapDefinition = async (mapPath: string): Promise<MapDefinition> => {
    const raw = await readJsonFile(mapPath);
    return MapDefinitionSchema.parse(raw);
};

export const loadMapDefinitionByName = async (mapName: string, options?: MapLoaderOptions): Promise<MapDefinition> => {
    const mapPath = resolveMapDefinitionPath(mapName, options);
    return loadMapDefinition(mapPath);
};
