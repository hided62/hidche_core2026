import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_TURN_COMMAND_PROFILE, parseTurnCommandProfile, type TurnCommandProfile } from '@sammo-ts/logic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_PROFILE_PATH = path.resolve(REPO_ROOT, 'resources', 'turn-commands', 'default.json');

export interface TurnCommandProfileOptions {
    filePath?: string;
}

const readCommandProfile = async (filePath: string): Promise<TurnCommandProfile> => {
    const raw = await fs.readFile(filePath, 'utf8');
    return parseTurnCommandProfile(JSON.parse(raw) as unknown);
};

export const loadTurnCommandProfile = async (options?: TurnCommandProfileOptions): Promise<TurnCommandProfile> => {
    const filePath = options?.filePath ?? process.env.TURN_COMMANDS_PATH ?? DEFAULT_PROFILE_PATH;
    try {
        return await readCommandProfile(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return DEFAULT_TURN_COMMAND_PROFILE;
        }
        throw error;
    }
};
