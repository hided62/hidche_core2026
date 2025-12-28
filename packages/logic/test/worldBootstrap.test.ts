import { describe, expect, it } from 'vitest';

import type { ScenarioDefinition } from '../src/scenario/types.js';
import type { MapDefinition, UnitSetDefinition } from '../src/world/types.js';
import { buildScenarioBootstrap } from '../src/world/bootstrap.js';

describe('scenario bootstrap', () => {
    it('builds snapshot and seed from scenario/map inputs', () => {
        const scenario: ScenarioDefinition = {
            title: 'Test Scenario',
            startYear: 200,
            life: null,
            fiction: null,
            history: [],
            config: {
                stat: {
                    total: 100,
                    min: 10,
                    max: 70,
                    npcTotal: 80,
                    npcMax: 60,
                    npcMin: 5,
                    chiefMin: 50,
                },
                iconPath: '.',
                map: {},
                const: {},
                environment: {
                    mapName: 'test-map',
                    unitSet: 'test-unit',
                },
            },
            nations: [
                {
                    id: 1,
                    name: 'TestNation',
                    color: '#123456',
                    gold: 5000,
                    rice: 3000,
                    infoText: 'Test nation',
                    tech: 100,
                    type: 'Test',
                    level: 3,
                    cities: ['Alpha'],
                },
            ],
            diplomacy: [],
            generals: [
                {
                    affinity: 10,
                    name: 'TestGeneral',
                    picture: 101,
                    nation: 1,
                    city: 'Alpha',
                    leadership: 50,
                    strength: 60,
                    intelligence: 55,
                    officerLevel: 1,
                    birthYear: 180,
                    deathYear: 240,
                    personality: 'Calm',
                    special: 'Special',
                    text: 'Test line',
                },
            ],
            generalsEx: [],
            generalsNeutral: [],
            cities: [],
            events: [],
            initialEvents: [],
            ignoreDefaultEvents: false,
        };

        const map: MapDefinition = {
            id: 'test-map',
            name: 'test-map',
            cities: [
                {
                    id: 1,
                    name: 'Alpha',
                    level: 3,
                    region: 1,
                    position: { x: 10, y: 20 },
                    connections: [],
                    max: {
                        population: 100000,
                        agriculture: 20000,
                        commerce: 20000,
                        security: 15000,
                        defence: 5000,
                        wall: 3000,
                    },
                    initial: {
                        population: 50000,
                        agriculture: 10000,
                        commerce: 10000,
                        security: 8000,
                        defence: 2500,
                        wall: 1500,
                    },
                },
            ],
        };

        const unitSet: UnitSetDefinition = {
            id: 'test-unit',
            name: 'test-unit',
            defaultCrewTypeId: 1200,
        };

        const result = buildScenarioBootstrap({ scenario, map, unitSet });

        expect(result.warnings).toHaveLength(0);
        expect(result.snapshot.nations).toHaveLength(2);
        expect(result.seed.nations).toHaveLength(1);
        expect(result.snapshot.cities[0]?.nationId).toBe(1);
        expect(result.seed.cities[0]?.nationId).toBe(1);
        expect(result.snapshot.generals[0]?.cityId).toBe(1);
        expect(result.snapshot.generals[0]?.crewTypeId).toBe(1200);
        expect(result.snapshot.generals[0]?.role.specialDomestic).toBe('Special');
        expect(result.snapshot.generals[0]?.role.specialWar).toBeNull();
        expect(result.seed.generals[0]?.npcType).toBe(2);
        expect(result.snapshot.scenarioMeta?.title).toBe('Test Scenario');
    });
});
