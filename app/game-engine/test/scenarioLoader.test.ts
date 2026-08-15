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

    it('opens nation betting in the first playable year of every scenario 29 variant', async () => {
        const scenarioIds = [2900, 2901, 2903, 2904];
        const scenarios = await Promise.all(scenarioIds.map((scenarioId) => loadScenarioDefinitionById(scenarioId)));

        for (const scenario of scenarios) {
            expect(scenario.startYear).toBe(2025);
            expect(scenario.events).toContainEqual([
                'month',
                999,
                ['Date', '==', 2026, 1],
                ['OpenNationBetting', 1, 2000],
                ['DeleteEvent'],
            ]);
        }
    });
});
