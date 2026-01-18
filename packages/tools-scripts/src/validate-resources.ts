import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    MapResourceSchema,
    ScenarioResourceSchema,
    TurnCommandProfileInputSchema,
    UnitSetDefinitionInputSchema,
} from '@sammo-ts/logic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RESOURCE_ROOT = path.join(REPO_ROOT, 'resources');

const RESOURCE_SCHEMAS: Record<string, (value: unknown) => void> = {
    map: (value) => MapResourceSchema.parse(value),
    scenario: (value) => ScenarioResourceSchema.parse(value),
    unitset: (value) => UnitSetDefinitionInputSchema.parse(value),
    'turn-commands': (value) => TurnCommandProfileInputSchema.parse(value),
};

const listJsonFiles = async (dirPath: string): Promise<string[]> => {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'schema.json')
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
};

const validateFolder = async (folder: string): Promise<string[]> => {
    const schema = RESOURCE_SCHEMAS[folder];
    if (!schema) {
        return [`Unknown resource folder: ${folder}`];
    }
    const folderPath = path.join(RESOURCE_ROOT, folder);
    const files = await listJsonFiles(folderPath);
    const errors: string[] = [];

    for (const fileName of files) {
        const filePath = path.join(folderPath, fileName);
        const raw = await fs.readFile(filePath, 'utf8');
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw) as unknown;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${path.relative(REPO_ROOT, filePath)}: invalid JSON (${message})`);
            continue;
        }
        try {
            schema(parsed);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${path.relative(REPO_ROOT, filePath)}: ${message}`);
        }
    }

    return errors;
};

const main = async (): Promise<void> => {
    const folders = Object.keys(RESOURCE_SCHEMAS).sort((a, b) => a.localeCompare(b));
    const allErrors: string[] = [];

    for (const folder of folders) {
        const errors = await validateFolder(folder);
        allErrors.push(...errors);
    }

    if (allErrors.length > 0) {
        for (const error of allErrors) {
            console.error(`[resource-validate] ${error}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('[resource-validate] OK');
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
