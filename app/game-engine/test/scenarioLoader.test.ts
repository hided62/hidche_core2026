import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadScenarioDefinitionById, resolveScenarioDefaultsPath } from '../src/scenario/scenarioLoader.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';

type LoadedScenario = Awaited<ReturnType<typeof loadScenarioDefinitionById>>;

const readItemSlot = (scenario: LoadedScenario, slot: string): Record<string, number> => {
    const allItems = scenario.config.const.allItems as Record<string, Record<string, number>> | undefined;
    return allItems?.[slot] ?? {};
};

const readAvailableSpecialWar = (scenario: LoadedScenario): string[] =>
    (scenario.config.const.availableSpecialWar as string[] | undefined) ?? [];

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

    it('keeps the buyable war-special pack scoped to each Ref scenario contract', async () => {
        const [ordinaryBlank, legacySecretBlank, mirrorBlank, multiUnitBlank, moreEffectBlank, composedAddon] =
            await Promise.all(
                [0, 902, 910, 912, 913, 2141].map((scenarioId) => loadScenarioDefinitionById(scenarioId))
            );

        expect(
            Object.keys(readItemSlot(ordinaryBlank, 'item')).filter((key) => key.startsWith('event_전투특기_'))
        ).toEqual([]);

        const legacySecretItems = readItemSlot(legacySecretBlank, 'item');
        expect(Object.keys(legacySecretItems).filter((key) => key.startsWith('event_전투특기_'))).toHaveLength(19);
        expect(legacySecretItems).not.toHaveProperty('event_전투특기_견고');
        expect(readAvailableSpecialWar(legacySecretBlank)).not.toContain('che_견고');

        const mirrorItems = readItemSlot(mirrorBlank, 'item');
        expect(Object.keys(mirrorItems).filter((key) => key.startsWith('event_전투특기_'))).toHaveLength(19);
        expect(mirrorItems).not.toHaveProperty('event_전투특기_척사');
        expect(readAvailableSpecialWar(mirrorBlank)).not.toContain('che_척사');

        const multiUnitItems = readItemSlot(multiUnitBlank, 'item');
        expect(Object.keys(multiUnitItems).filter((key) => key.startsWith('event_전투특기_'))).toHaveLength(19);
        expect(multiUnitItems).not.toHaveProperty('event_전투특기_견고');

        const moreEffectItems = readItemSlot(moreEffectBlank, 'item');
        const composedAddonItems = readItemSlot(composedAddon, 'item');
        expect(Object.keys(moreEffectItems).filter((key) => key.startsWith('event_전투특기_'))).toHaveLength(20);
        expect(Object.keys(composedAddonItems).filter((key) => key.startsWith('event_전투특기_'))).toHaveLength(20);
        expect(readItemSlot(moreEffectBlank, 'horse').che_명마_07_백마).toBe(4);
        expect(readItemSlot(composedAddon, 'horse').che_명마_07_백마).toBe(2);
    });

    it('projects ordinary and explicit secret-item scenario pools into command execution', async () => {
        const [ordinaryBlank, secretScenario] = await Promise.all(
            [1, 2701].map((scenarioId) => loadScenarioDefinitionById(scenarioId))
        );
        const ordinaryKeys = buildCommandEnv(ordinaryBlank.config).purchasableItemKeys;
        const secretScenarioKeys = buildCommandEnv(secretScenario.config).purchasableItemKeys;

        expect(ordinaryKeys?.size).toBe(24);
        expect(ordinaryKeys?.has('che_치료_환약')).toBe(true);
        expect([...ordinaryKeys!].filter((key) => key.startsWith('event_전투특기_'))).toEqual([]);
        expect([...secretScenarioKeys!].filter((key) => key.startsWith('event_전투특기_'))).toHaveLength(20);
        expect(secretScenarioKeys?.has('event_전투특기_격노')).toBe(true);
    });

    it('keeps join allocation bounds separate from the Ref runtime stat level limit', async () => {
        const scenario = await loadScenarioDefinitionById(1);

        expect(scenario.config.stat.max).toBe(80);
        expect(buildCommandEnv(scenario.config).maxStatLevel).toBe(255);
        expect(
            buildCommandEnv({
                ...scenario.config,
                const: { ...scenario.config.const, maxLevel: 512 },
            }).maxStatLevel
        ).toBe(512);
    });
});
