import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    parseScenarioDefaults,
    parseScenarioDefinition,
    type ScenarioDefaults,
    type ScenarioDefinition,
} from '@sammo-ts/logic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
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
    // 시나리오 본문을 읽고 기본값과 합쳐서 파싱한다.
    const raw = await readJsonFile(scenarioPath);
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
