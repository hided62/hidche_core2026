import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadScenarioDefinitionById, resolveScenarioDefaultsPath } from '../src/scenario/scenarioLoader.js';

describe('tracked scenario resources', () => {
    it('loads every scenario through its composed resource graph', async () => {
        const scenarioRoot = path.dirname(resolveScenarioDefaultsPath());
        const files = await fs.readdir(scenarioRoot);
        const scenarioIds = files
            .map((fileName) => /^scenario_(\d+)\.json$/.exec(fileName))
            .filter((match): match is RegExpExecArray => match !== null)
            .map((match) => Number(match[1]))
            .sort((left, right) => left - right);

        expect(scenarioIds).toHaveLength(80);
        const scenarios = await Promise.all(scenarioIds.map((scenarioId) => loadScenarioDefinitionById(scenarioId)));
        expect(scenarios.every((scenario) => scenario.title.length > 0)).toBe(true);
    });
});
