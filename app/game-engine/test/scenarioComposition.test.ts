import { describe, expect, it } from 'vitest';

import {
    composeScenarioResource,
    mergeScenarioResources,
    type ScenarioResourceReader,
} from '../src/scenario/scenarioComposition.js';

const createReader =
    (resources: Record<string, unknown>): ScenarioResourceReader =>
    async (relativePath) => {
        if (!(relativePath in resources)) {
            throw new Error(`Missing fixture: ${relativePath}`);
        }
        return resources[relativePath];
    };

describe('scenario composition', () => {
    it('deep-merges objects while replacing arrays and scalar values', () => {
        expect(
            mergeScenarioResources(
                {
                    const: {
                        allItems: {
                            horse: { baseHorse: 1 },
                        },
                        availableSpecialWar: ['base'],
                    },
                    events: [['base']],
                },
                {
                    const: {
                        allItems: {
                            item: { addedItem: 2 },
                        },
                        availableSpecialWar: ['extended'],
                        nestedMetadata: { extends: 'ordinary-value' },
                    },
                    events: [['extended']],
                }
            )
        ).toEqual({
            const: {
                allItems: {
                    horse: { baseHorse: 1 },
                    item: { addedItem: 2 },
                },
                availableSpecialWar: ['extended'],
                nestedMetadata: { extends: 'ordinary-value' },
            },
            events: [['extended']],
        });
    });

    it('applies extensions from left to right before the scenario body', async () => {
        const result = await composeScenarioResource(
            'scenario_1.json',
            createReader({
                'scenario_1.json': {
                    title: 'composed',
                    extends: ['extensions/base.json', 'extensions/items.json'],
                    const: {
                        limit: 30,
                    },
                },
                'extensions/base.json': {
                    map: { mapName: 'che', unitSet: 'che' },
                    const: { limit: 10, baseOnly: true },
                    events: [['base']],
                },
                'extensions/items.json': {
                    extends: '../shared/item-base.json',
                    const: {
                        allItems: {
                            item: { eventItem: 1 },
                        },
                    },
                },
                'shared/item-base.json': {
                    const: {
                        availableSpecialWar: ['che_귀병'],
                        allItems: {
                            horse: { uniqueHorse: 2 },
                        },
                    },
                },
            })
        );

        expect(result).toEqual({
            title: 'composed',
            map: { mapName: 'che', unitSet: 'che' },
            const: {
                limit: 30,
                baseOnly: true,
                availableSpecialWar: ['che_귀병'],
                allItems: {
                    horse: { uniqueHorse: 2 },
                    item: { eventItem: 1 },
                },
            },
            events: [['base']],
        });
        expect(result).not.toHaveProperty('extends');
    });

    it('rejects cycles and paths outside the scenario root', async () => {
        const cyclicReader = createReader({
            'scenario_1.json': { title: 'cycle', extends: 'extensions/a.json' },
            'extensions/a.json': { extends: '../scenario_1.json' },
        });

        await expect(composeScenarioResource('scenario_1.json', cyclicReader)).rejects.toThrow(
            'Scenario composition cycle'
        );
        await expect(
            composeScenarioResource(
                'scenario_1.json',
                createReader({
                    'scenario_1.json': { title: 'escape', extends: '../outside.json' },
                })
            )
        ).rejects.toThrow('escapes the scenario resource root');
    });
});
