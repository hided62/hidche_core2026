import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseUnitSetDefinition, type UnitSetDefinition } from '@sammo-ts/logic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_UNIT_SET_ROOT = path.resolve(__dirname, '..', '..', '..', 'game-engine', 'resources', 'unitset');

export interface UnitSetLoaderOptions {
    unitSetRoot?: string;
    filePrefix?: string;
}

const readJsonFile = async (filePath: string): Promise<unknown> => {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
};

const resolveUnitSetRoot = (options?: UnitSetLoaderOptions): string => options?.unitSetRoot ?? DEFAULT_UNIT_SET_ROOT;

export const resolveUnitSetDefinitionPath = (unitSetName: string, options?: UnitSetLoaderOptions): string => {
    const prefix = options?.filePrefix ?? 'unitset_';
    return path.resolve(resolveUnitSetRoot(options), `${prefix}${unitSetName}.json`);
};

export const loadUnitSetDefinition = async (unitSetPath: string): Promise<UnitSetDefinition> => {
    const raw = await readJsonFile(unitSetPath);
    return parseUnitSetDefinition(raw);
};

export const loadUnitSetDefinitionByName = async (
    unitSetName: string,
    options?: UnitSetLoaderOptions
): Promise<UnitSetDefinition> => {
    const unitSetPath = resolveUnitSetDefinitionPath(unitSetName, options);
    return loadUnitSetDefinition(unitSetPath);
};
