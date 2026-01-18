import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import {
    MapResourceSchema,
    ScenarioResourceSchema,
    TurnCommandProfileInputSchema,
    UnitSetDefinitionInputSchema,
} from '@sammo-ts/logic/resources';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RESOURCE_ROOT = path.join(REPO_ROOT, 'resources');

const writeSchema = async (relativePath: string, schema: ZodTypeAny): Promise<void> => {
    const outputPath = path.join(RESOURCE_ROOT, relativePath);
    const jsonSchema = z.toJSONSchema(schema, { target: 'draft-07' });
    const serialized = `${JSON.stringify(jsonSchema, null, 4)}\n`;
    await fs.writeFile(outputPath, serialized, 'utf8');
};

const main = async (): Promise<void> => {
    await writeSchema(path.join('map', 'schema.json'), MapResourceSchema);
    await writeSchema(path.join('scenario', 'schema.json'), ScenarioResourceSchema);
    await writeSchema(path.join('unitset', 'schema.json'), UnitSetDefinitionInputSchema);
    await writeSchema(path.join('turn-commands', 'schema.json'), TurnCommandProfileInputSchema);
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
