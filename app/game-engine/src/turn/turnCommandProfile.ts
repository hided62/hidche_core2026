import fs from 'node:fs/promises';
import path from 'node:path';

import {
    parseTurnCommandProfile,
    resolveScenarioTurnCommandProfile,
    type ScenarioTurnCommandProfileResolution,
    type TurnCommandProfile,
} from '@sammo-ts/logic';

import { resolveWorkspaceRoot } from '../paths.js';

const REPO_ROOT = resolveWorkspaceRoot();
const DEFAULT_PROFILE_PATH = path.resolve(REPO_ROOT, 'resources', 'turn-commands', 'default.json');

export interface TurnCommandProfileOptions {
    filePath?: string;
    scenarioConst?: unknown;
}

const readCommandProfile = async (filePath: string): Promise<TurnCommandProfile> => {
    const raw = await fs.readFile(filePath, 'utf8');
    return parseTurnCommandProfile(JSON.parse(raw) as unknown);
};

export const loadScenarioTurnCommandProfile = async (
    options?: TurnCommandProfileOptions
): Promise<ScenarioTurnCommandProfileResolution> => {
    const filePath = options?.filePath ?? process.env.TURN_COMMANDS_PATH ?? DEFAULT_PROFILE_PATH;
    const fallback = await readCommandProfile(filePath);
    return resolveScenarioTurnCommandProfile(options?.scenarioConst, fallback);
};

export const loadTurnCommandProfile = async (options?: TurnCommandProfileOptions): Promise<TurnCommandProfile> =>
    (await loadScenarioTurnCommandProfile(options)).profile;
