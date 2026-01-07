
import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { MINIMAL_MAP } from '../fixtures/minimalMap.js';
import { InMemoryWorld, TestGameRunner } from '../testEnv.js';
import { buildScenarioBootstrap } from '../../src/world/bootstrap.js';
import type { ScenarioDefinition, ScenarioGeneral } from '../../src/scenario/types.js';
import type { MapDefinition } from '../../src/world/types.js';
import type { General, Nation } from '../../src/domain/entities.js';
import { commandSpec as foundNationSpec } from '../../src/actions/turn/general/che_건국.js';
import type { TurnCommandEnv } from '../../src/actions/turn/commandEnv.js';

// Mock Scenario Definition
const MOCK_SCENARIO: ScenarioDefinition = {
    id: 'test_scenario',
    title: 'Test Scenario',
    template: 'test',
    startYear: 189,
    beginYear: 189,
    endYear: 250,
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
        environment: {
            mapName: 'minimal_map',
            unitSet: 'test_set',
            startYear: 189,
        },
        options: {},
    },
};

// Mock General Data
const MOCK_GENERALS: ScenarioGeneral[] = Array.from({ length: 10 }, (_, i) => ({
    name: `General_${i}`,
    nation: null, // neutral
    city: MINIMAL_MAP.cities[i % MINIMAL_MAP.cities.length].name,
    npc: 0,
    p_name: `General_${i}`, // Using p_name as personality/picture placeholder if needed by types
    uniqueName: `General_${i}`,
    officerLevel: 0,
    birthYear: 160,
    deathYear: 220,
    strength: 70 + i,
    intelligence: 70 + i,
    leadership: 70 + i,
    charm: 70 + i, // Note: entities.ts checks stats, ensuring keys match
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
}));

// We need to inject generals into the scenario object for bootstrap
const scenarioWithGenerals = produce(MOCK_SCENARIO, draft => {
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
            }
        });

        const world = new InMemoryWorld(bootstrapResult.snapshot);
        const runner = new TestGameRunner(world, 189, 1);

        // 2. Identify a target general (e.g., General_0 in City 1)
        const targetGeneral = world.getAllGenerals().find(g => g.name === 'General_0');
        expect(targetGeneral).toBeDefined();
        if (!targetGeneral) return;

        expect(targetGeneral.nationId).toBe(0); // Should be neutral (nation 0 commonly used for neutral in sammo, or checking bootstrap logic)
        // bootstrap puts neutral in nation 0 if includeNeutralNation is true.

        // 3. Command: Found Nation
        const env: TurnCommandEnv = {
            general: targetGeneral,
            date: new Date(189, 0, 1),
        };
        const foundNationDef = foundNationSpec.createDefinition(env);

        // Execute Turn
        // We simulate the turn runner processing this command
        await runner.runTurn([
            {
                generalId: targetGeneral.id,
                commandKey: 'che_건국',
                resolver: foundNationDef,
                args: {}
            }
        ]);

        // 4. Simulate Turn Processing (Daemon Logic Mock)
        // Since logic/actions/engine doesn't auto-create nation, we simulate the "Post-Turn Phase"
        // that scans for the 'founding' flag.

        const generalAfter = world.getGeneral(targetGeneral.id);
        expect(generalAfter?.meta?.founding).toBe(true);

        if (generalAfter?.meta?.founding) {
            // Mock Daemon: Create Nation
            const newNationId = Math.max(...world.getAllNations().map(n => n.id), 0) + 1;
            const newNation: Nation = {
                id: newNationId,
                name: `${generalAfter.name}국`,
                color: '#FF0000',
                capitalCityId: generalAfter.cityId,
                chiefGeneralId: generalAfter.id,
                gold: 1000,
                rice: 1000,
                power: 0,
                level: 1,
                typeCode: 'che_def',
                meta: {}
            };

            // Apply updates manually to world
            // In a real test we'd add methods to InMemoryWorld to do this cleanly
            (world as any).snapshot.nations.push(newNation);

            const city = world.getCity(generalAfter.cityId);
            if (city) {
                (world as any).updateCity({ ...city, nationId: newNationId });
            }

            (world as any).updateGeneral({ ...generalAfter, nationId: newNationId, meta: { ...generalAfter.meta, founding: false } });
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
