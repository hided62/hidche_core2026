import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseScenarioDefaults, parseScenarioDefinition } from '../src/scenario/parseScenario.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const scenarioRoot = path.join(repoRoot, 'resources', 'scenario');

const readJson = async (filePath: string): Promise<unknown> => {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
};

describe('scenario parser', () => {
    it('reads defaults from the tracked legacy-format default.json', async () => {
        const defaultsRaw = await readJson(path.join(scenarioRoot, 'default.json'));
        const defaults = parseScenarioDefaults(defaultsRaw);

        expect(defaults.stat.total).toBe(165);
        expect(defaults.stat.min).toBe(15);
        expect(defaults.stat.max).toBe(80);
        expect(defaults.stat.npcTotal).toBe(150);
        expect(defaults.stat.npcMax).toBe(75);
        expect(defaults.stat.npcMin).toBe(10);
        expect(defaults.stat.chiefMin).toBe(65);
        expect(defaults.iconPath).toBe('.');
    });

    it('defaults map/unit set when scenario omits map config', async () => {
        const defaultsRaw = await readJson(path.join(scenarioRoot, 'default.json'));
        const scenarioRaw = await readJson(path.join(scenarioRoot, 'scenario_0.json'));
        const defaults = parseScenarioDefaults(defaultsRaw);
        const scenario = parseScenarioDefinition(scenarioRaw, defaults);

        expect(scenario.config.environment.mapName).toBe('che');
        expect(scenario.config.environment.unitSet).toBe('che');
    });

    it('parses nation/general rows from a legacy scenario', async () => {
        const defaultsRaw = await readJson(path.join(scenarioRoot, 'default.json'));
        const scenarioRaw = await readJson(path.join(scenarioRoot, 'scenario_1010.json'));
        const defaults = parseScenarioDefaults(defaultsRaw);
        const scenario = parseScenarioDefinition(scenarioRaw, defaults);

        expect(scenario.nations.length).toBeGreaterThan(0);
        expect(scenario.generals.length).toBeGreaterThan(0);

        const firstNation = scenario.nations[0]!;
        expect(firstNation.name).toBe('후한');
        expect(firstNation.color).toBe('#800000');

        const firstGeneral = scenario.generals[0]!;
        expect(firstGeneral.name).toBe('소제1');
        expect(firstGeneral.affinity).toBe(1);
        expect(firstGeneral.picture).toBe('장수/소제1.jpg');
        expect(firstGeneral.nation).toBe(1);
        expect(firstGeneral.city).toBe(null);
        expect(firstGeneral.leadership).toBe(20);
        expect(firstGeneral.personality).toBe('유지');
        expect(firstGeneral.special).toBe(null);
    });

    it('reuses the canonical name-based icon in a scenario that omitted numeric pictures', async () => {
        const defaultsRaw = await readJson(path.join(scenarioRoot, 'default.json'));
        const scenarioRaw = await readJson(path.join(scenarioRoot, 'scenario_2220.json'));
        const defaults = parseScenarioDefaults(defaultsRaw);
        const scenario = parseScenarioDefinition(scenarioRaw, defaults);

        expect(scenario.generals[0]).toMatchObject({
            name: '아회남',
            picture: '장수/아회남.jpg',
        });
    });
});
