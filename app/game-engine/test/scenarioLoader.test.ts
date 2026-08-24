import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadScenarioDefinitionById, resolveScenarioDefaultsPath } from '../src/scenario/scenarioLoader.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import { hasRefSourceRoot, resolveRefSourceRoot } from './refSourceRoot.js';

type LoadedScenario = Awaited<ReturnType<typeof loadScenarioDefinitionById>>;

interface ReferenceScenario914 {
    title: string;
    startYear: number;
    map: Record<string, unknown>;
    history: string[];
    const: {
        allItems: Record<string, Record<string, number>>;
        [key: string]: unknown;
    };
    events: unknown[];
}

interface ReferenceScenario915 {
    title: string;
    startYear: number;
    map: Record<string, unknown>;
    history: string[];
    const: Record<string, unknown>;
    events: unknown[];
}

const readItemSlot = (scenario: LoadedScenario, slot: string): Record<string, number> => {
    const allItems = scenario.config.const.allItems as Record<string, Record<string, number>> | undefined;
    return allItems?.[slot] ?? {};
};

const readAvailableSpecialWar = (scenario: LoadedScenario): string[] =>
    (scenario.config.const.availableSpecialWar as string[] | undefined) ?? [];

const refSourceIt = hasRefSourceRoot() ? it : it.skip;

describe('tracked scenario resources', () => {
    it('loads every scenario through its composed resource graph', async () => {
        const scenarioRoot = path.dirname(resolveScenarioDefaultsPath());
        const files = await fs.readdir(scenarioRoot);
        const scenarioIds = files
            .map((fileName) => /^scenario_(\d+)\.json$/.exec(fileName))
            .filter((match): match is RegExpExecArray => match !== null)
            .map((match) => Number(match[1]))
            .sort((left, right) => left - right);

        expect(scenarioIds).toContain(914);
        expect(scenarioIds).toContain(915);
        expect(scenarioIds).toContain(916);
        const scenarios = await Promise.all(scenarioIds.map((scenarioId) => loadScenarioDefinitionById(scenarioId)));
        expect(scenarios.every((scenario) => scenario.title.length > 0)).toBe(true);
    });

    it('keeps scenario 916 equal to ordinary blank land except for its launch modifiers', async () => {
        const [ordinaryBlank, dawn] = await Promise.all(
            [0, 916].map((scenarioId) => loadScenarioDefinitionById(scenarioId))
        );
        const { uniqueTrialCoef, ...dawnConst } = dawn.config.const;

        expect(dawn.title).toBe('【공백지】 여명');
        expect(uniqueTrialCoef).toBe(2);
        expect({ ...dawn.config, const: dawnConst }).toEqual(ordinaryBlank.config);
        expect(dawn.history).toEqual(ordinaryBlank.history);
        expect(dawn.events[0]).toEqual([
            'month',
            1000,
            ['or', ['Date', '==', null, 12], ['Date', '==', null, 6]],
            ['CreateManyNPC', 50, 0],
            ['DeleteEvent'],
        ]);
        expect(dawn.events.slice(1)).toEqual(ordinaryBlank.events.slice(1));

        expect({
            ...dawn,
            title: ordinaryBlank.title,
            events: ordinaryBlank.events,
            config: ordinaryBlank.config,
        }).toEqual(ordinaryBlank);
    });

    refSourceIt('preserves the Ref scenario 915 S100 pool and event order exactly', async () => {
        const referencePath = path.join(resolveRefSourceRoot(), 'hwe', 'scenario', 'scenario_915.json');
        const [scenario, referenceSource] = await Promise.all([
            loadScenarioDefinitionById(915),
            fs.readFile(referencePath, 'utf8').then((raw) => JSON.parse(raw) as ReferenceScenario915),
        ]);

        expect(scenario.title).toBe(referenceSource.title);
        expect(scenario.startYear).toBe(referenceSource.startYear);
        expect(scenario.config.map).toEqual(referenceSource.map);
        expect(scenario.history).toEqual(referenceSource.history);
        expect(scenario.config.const).toEqual(referenceSource.const);
        expect(scenario.events).toEqual(referenceSource.events);
        expect(
            scenario.events
                .filter((entry): entry is unknown[] => Array.isArray(entry) && entry[0] === 'month')
                .map((entry) => ({ priority: entry[1], condition: entry[2], actions: entry.slice(3) }))
        ).toEqual([
            { priority: 8_000, condition: true, actions: [['AdvanceCentennialAllStar']] },
            {
                priority: 1_000,
                condition: ['Date', '==', null, 12],
                actions: [['CreateManyNPC', 100, 0], ['DeleteEvent']],
            },
            {
                priority: 1_000,
                condition: ['Date', '==', 181, 1],
                actions: [['RaiseNPCNation'], ['DeleteEvent']],
            },
            {
                priority: 999,
                condition: ['Date', '==', 181, 1],
                actions: [['OpenNationBetting', 4, 5_000], ['OpenNationBetting', 1, 2_000], ['DeleteEvent']],
            },
            {
                priority: 999,
                condition: ['and', ['Date', '>=', 183, 1], ['RemainNation', '<=', 8]],
                actions: [['OpenNationBetting', 1, 1_000], ['DeleteEvent']],
            },
        ]);
    });

    refSourceIt('preserves the Ref scenario 914 item pool, monthly action order, and deletion markers', async () => {
        const referencePath = path.join(resolveRefSourceRoot(), 'hwe', 'scenario', 'scenario_914.json');
        const [scenario, referenceSource] = await Promise.all([
            loadScenarioDefinitionById(914),
            fs.readFile(referencePath, 'utf8').then((raw) => JSON.parse(raw) as ReferenceScenario914),
        ]);

        expect(scenario.title).toBe(referenceSource.title);
        expect(scenario.startYear).toBe(referenceSource.startYear);
        expect(scenario.config.map).toEqual(referenceSource.map);
        expect(scenario.history).toEqual(referenceSource.history);
        expect(scenario.config.const).toEqual(referenceSource.const);
        expect(scenario.config.const.allItems).toEqual(referenceSource.const.allItems);
        for (const [slot, items] of Object.entries(referenceSource.const.allItems)) {
            expect(Object.keys(readItemSlot(scenario, slot))).toEqual(Object.keys(items));
        }
        expect(scenario.events).toEqual(referenceSource.events);

        const monthlyActionNames = scenario.events
            .filter((event): event is unknown[] => Array.isArray(event) && event[0] === 'month')
            .map((event) =>
                event
                    .slice(3)
                    .map((action) => (Array.isArray(action) && typeof action[0] === 'string' ? action[0] : null))
            );
        expect(monthlyActionNames).toEqual([
            ['CreateManyNPC', 'DeleteEvent'],
            ['RaiseNPCNation', 'DeleteEvent'],
            ['OpenNationBetting', 'OpenNationBetting', 'DeleteEvent'],
            ['ChangeCity'],
            ['ChangeCity'],
        ]);
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
