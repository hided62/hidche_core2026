import fs from 'node:fs/promises';
import path from 'node:path';

import {
    parseScenarioDefaults,
    parseScenarioDefinition,
    type ScenarioDefaults,
    type ScenarioDefinition,
} from '@sammo-ts/logic';

import { resolveWorkspaceRoot } from '../paths.js';
import { composeScenarioResource } from './scenarioComposition.js';

const REPO_ROOT = resolveWorkspaceRoot();
const DEFAULT_SCENARIO_ROOT = path.resolve(REPO_ROOT, 'resources', 'scenario');

export interface ScenarioLoaderOptions {
    scenarioRoot?: string;
    defaultsFileName?: string;
}

const readJsonFile = async (filePath: string): Promise<unknown> => {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
};

const resolveScenarioRoot = (options?: ScenarioLoaderOptions): string => options?.scenarioRoot ?? DEFAULT_SCENARIO_ROOT;

export const resolveScenarioDefaultsPath = (options?: ScenarioLoaderOptions): string =>
    path.resolve(resolveScenarioRoot(options), options?.defaultsFileName ?? 'default.json');

export const resolveScenarioPath = (options: ScenarioLoaderOptions | undefined, scenarioId: number): string =>
    path.resolve(resolveScenarioRoot(options), `scenario_${scenarioId}.json`);

export const loadScenarioDefaults = async (defaultsPath: string): Promise<ScenarioDefaults> => {
    // 기본 시나리오 파일을 읽고 정규화한다.
    const raw = await readJsonFile(defaultsPath);
    return parseScenarioDefaults(raw);
};

export const loadScenarioDefinition = async (
    scenarioPath: string,
    defaults: ScenarioDefaults
): Promise<ScenarioDefinition> => {
    // 시나리오 확장 조각을 먼저 합성한 뒤 기본값과 함께 정규화한다.
    const scenarioRoot = path.dirname(scenarioPath);
    const raw = await composeScenarioResource(path.basename(scenarioPath), async (relativePath) => {
        const resolvedPath = path.resolve(scenarioRoot, relativePath);
        const rootPrefix = `${path.resolve(scenarioRoot)}${path.sep}`;
        if (!resolvedPath.startsWith(rootPrefix)) {
            throw new Error(`Scenario resource path escapes the configured root: ${relativePath}.`);
        }
        return readJsonFile(resolvedPath);
    });
    return parseScenarioDefinition(raw, defaults);
};

export const loadScenarioDefinitionById = async (
    scenarioId: number,
    options?: ScenarioLoaderOptions
): Promise<ScenarioDefinition> => {
    // 시나리오 번호로 파일을 찾고 파싱한다.
    const defaultsPath = resolveScenarioDefaultsPath(options);
    const scenarioPath = resolveScenarioPath(options, scenarioId);
    const defaults = await loadScenarioDefaults(defaultsPath);
    return loadScenarioDefinition(scenarioPath, defaults);
};
