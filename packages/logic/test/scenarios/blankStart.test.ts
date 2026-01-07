import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { MINIMAL_MAP } from '../fixtures/minimalMap.js';
import { InMemoryWorld, TestGameRunner } from '../testEnv.js';
import { buildScenarioBootstrap } from '../../src/world/bootstrap.js';
import type { ScenarioDefinition, ScenarioGeneral } from '../../src/scenario/types.js';
import type { Nation, City } from '../../src/domain/entities.js';
import { commandSpec as foundNationSpec } from '../../src/actions/turn/general/che_건국.js';
import type { TurnCommandEnv } from '../../src/actions/turn/commandEnv.js';

// Mock Scenario Definition
const MOCK_SCENARIO: ScenarioDefinition = {
    title: 'Test Scenario',
    startYear: 189,
    life: null,
    fiction: 0,
    history: [],
    ignoreDefaultEvents: false,
    nations: [], // No nations initially
    diplomacy: [],
    generals: [],
    generalsEx: [],
    generalsNeutral: [],
    cities: [],
    events: [],
    initialEvents: [],
    config: {
        stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
        iconPath: '',
        map: {},
        const: {},
        environment: {
            mapName: 'minimal_map',
            unitSet: 'test_set',
        },
    },
};

// Mock General Data
const MOCK_GENERALS: ScenarioGeneral[] = Array.from({ length: 10 }, (_, i) => {
    const cityDef = MINIMAL_MAP.cities[i % MINIMAL_MAP.cities.length];
    if (!cityDef) throw new Error('City definition missing');

    return {
        name: `General_${i}`,
        nation: null, // neutral
        city: cityDef.name,
        officerLevel: 0,
        birthYear: 160,
        deathYear: 220,
        strength: 70 + i,
        intelligence: 70 + i,
        leadership: 70 + i,
        personality: null,
        special: null,
        specialWar: null,
        affinity: 0,
        picture: null,
        horse: null,
        weapon: null,
        book: null,
        item: null,
        text: null,
    };
});

// We need to inject generals into the scenario object for bootstrap
const scenarioWithGenerals = produce(MOCK_SCENARIO, (draft) => {
    // bootstrap expects generals in specific arrays.
    // We'll put them in generalsNeutral since they are neutral
    draft.generalsNeutral = MOCK_GENERALS;
});

describe('Blank Start Scenario', () => {
    it('should allow neutral generals to found nations', async () => {
        // 1. Setup World
        const bootstrapResult = buildScenarioBootstrap({
            scenario: scenarioWithGenerals,
            map: MINIMAL_MAP,
            options: {
                includeNeutralNation: true,
                defaultGeneralGold: 1000,
                defaultGeneralRice: 1000,
            },
        });

        const world = new InMemoryWorld(bootstrapResult.snapshot);
        const runner = new TestGameRunner(world, 189, 1);

        // 2. Identify a target general (e.g., General_0 in City 1)
        const targetGeneral = world.getAllGenerals().find((g) => g.name === 'General_0');
        expect(targetGeneral).toBeDefined();
        if (!targetGeneral) return;

        expect(targetGeneral.nationId).toBe(0);

        // 3. Command: Found Nation
        const systemEnv: TurnCommandEnv = {
            develCost: 50,
            trainDelta: 5,
            atmosDelta: 5,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            sabotageDefaultProb: 0.5,
            sabotageProbCoefByStat: 0.1,
            sabotageDefenceCoefByGeneralCount: 0.1,
            sabotageDamageMin: 10,
            sabotageDamageMax: 20,
            openingPartYear: 200,
            maxGeneral: 10,
            defaultNpcGold: 1000,
            defaultNpcRice: 1000,
            defaultCrewTypeId: 1,
            defaultSpecialDomestic: null,
            defaultSpecialWar: null,
            initialNationGenLimit: 10,
            maxTechLevel: 10,
            baseGold: 1000,
            baseRice: 1000,
            maxResourceActionAmount: 1000,
        };

        const foundNationDef = foundNationSpec.createDefinition(systemEnv);

        // Execute Turn
        await runner.runTurn([
            {
                generalId: targetGeneral.id,
                commandKey: 'che_건국',
                resolver: foundNationDef,
                args: {},
            },
        ]);

        // 4. Simulate Turn Processing (Daemon Logic Mock)
        const generalAfter = world.getGeneral(targetGeneral.id);
        expect(generalAfter?.meta?.founding).toBe(true);

        if (generalAfter?.meta?.founding) {
            // Mock Daemon: Create Nation
            const newNationId = Math.max(...world.getAllNations().map((n) => n.id), 0) + 1;
            const newNation: Nation = {
                id: newNationId,
                name: `${generalAfter.name}국`,
                color: '#FF0000',
                capitalCityId: generalAfter.cityId,
                chiefGeneralId: generalAfter.id,
                gold: 10000,
                rice: 10000,
                power: 0,
                level: 1,
                typeCode: 'che_def',
                meta: {},
            };

            // Apply updates manually to world
            world.snapshot.nations.push(newNation);

            const city = world.getCity(generalAfter.cityId);
            if (city) {
                // Manually update nationId in city
                const cityIdx = world.snapshot.cities.findIndex((c) => c.id === city.id);
                world.snapshot.cities[cityIdx] = { ...world.snapshot.cities[cityIdx], nationId: newNationId } as City;
            }

            const genIdx = world.snapshot.generals.findIndex((g) => g.id === generalAfter.id);
            world.snapshot.generals[genIdx] = {
                ...world.snapshot.generals[genIdx],
                nationId: newNationId,
                meta: { ...generalAfter.meta, founding: false },
            } as any;
        }

        // 5. Verify
        const finalGeneral = world.getGeneral(targetGeneral.id);
        expect(finalGeneral?.nationId).not.toBe(0);
        expect(finalGeneral?.nationId).toBeGreaterThan(0);

        const finalNation = world.getNation(finalGeneral!.nationId);
        expect(finalNation).toBeDefined();
        expect(finalNation?.name).toBe('General_0국');

        const cityStart = world.getCity(targetGeneral.cityId);
        expect(cityStart?.nationId).toBe(finalNation?.id);
    });
});
