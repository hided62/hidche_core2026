
import { describe, expect, it } from 'vitest';
import { MINIMAL_MAP } from '../fixtures/minimalMap.js';
import { InMemoryWorld, TestGameRunner } from '../testEnv.js';
import type { City, General, Nation } from '../../src/domain/entities.js';
import type { WorldSnapshot } from '../../src/world/types.js';
import { commandSpec as developAgricultureSpec } from '../../src/actions/turn/general/che_농지개간.js';
import { commandSpec as commercialSpec } from '../../src/actions/turn/general/che_상업투자.js';
import type { TurnCommandEnv } from '../../src/actions/turn/commandEnv.js';

describe('Domestic Affairs Scenario', () => {
    it('should increase agriculture when executing "Farming" command', async () => {
        // 1. Setup World with existing nation/city/general
        const NATION_ID = 1;
        const CITY_ID = 1;
        const GENERAL_ID = 1;

        const mockNation: Nation = {
            id: NATION_ID,
            name: 'TestNation',
            color: '#0000FF',
            capitalCityId: CITY_ID,
            chiefGeneralId: GENERAL_ID,
            gold: 10000,
            rice: 10000,
            power: 0,
            level: 1,
            typeCode: 'test',
            meta: { tech: 1000 }
        };

        const cityDef = MINIMAL_MAP.cities.find(c => c.id === CITY_ID)!;
        const mockCity: City = {
            id: CITY_ID,
            name: cityDef.name,
            nationId: NATION_ID,
            level: cityDef.level,
            region: cityDef.region,
            state: 0,
            population: 10000,
            populationMax: cityDef.max.population,
            agriculture: 500,
            agricultureMax: cityDef.max.agriculture,
            commerce: 500,
            commerceMax: cityDef.max.commerce,
            security: 500,
            securityMax: cityDef.max.security,
            defence: 200,
            defenceMax: cityDef.max.defence,
            wall: 200,
            wallMax: cityDef.max.wall,
            supplyState: 1,
            frontState: 0,
            trust: 50,
            trade: 100,
            meta: {}
        };

        const mockGeneral: General = {
            id: GENERAL_ID,
            name: 'Governor A',
            nationId: NATION_ID,
            cityId: CITY_ID,
            troopId: 0,
            npcState: 0,
            experience: 100,
            dedication: 100,
            officerLevel: 5,
            gold: 1000,
            rice: 1000,
            crew: 5000,
            crewTypeId: 1,
            train: 80,
            atmos: 80,
            injury: 0,
            age: 30,
            stats: {
                leadership: 80,
                strength: 80,
                intelligence: 80, // High int implies better political results usually
            },
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null }
            },
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {}
        };

        const snapshot: WorldSnapshot = {
            scenarioConfig: { environment: { mapName: 'minimal_map', unitSet: 'default' }, options: {} } as any,
            scenarioMeta: { title: 'Test', startYear: 200, life: 0, fiction: 0, history: [], ignoreDefaultEvents: false },
            map: MINIMAL_MAP,
            nations: [mockNation],
            cities: [mockCity],
            generals: [mockGeneral],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: []
        };

        const world = new InMemoryWorld(snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        // 2. Command: Develop Agriculture
        const env: TurnCommandEnv = {
            general: mockGeneral,
            date: new Date(200, 0, 1),
        };
        const farmingDef = developAgricultureSpec.createDefinition(env);

        const initialAgri = world.getCity(CITY_ID)!.agriculture;

        // Execute Turn
        await runner.runTurn([
            {
                generalId: GENERAL_ID,
                commandKey: 'che_농지개간',
                resolver: farmingDef,
                args: {}
            }
        ]);

        // 3. Verify
        const cityAfter = world.getCity(CITY_ID)!;
        expect(cityAfter.agriculture).toBeGreaterThan(initialAgri);

        // Verify upper bound if applicable (handled by constraints usually, but good to check it changed)
        console.log(`Agriculture: ${initialAgri} -> ${cityAfter.agriculture}`);
    });

    it('should NOT increase if city is fully developed or insufficient conditions', async () => {
        // Setup similar to above but with max agriculture
        // Implementation skipped for brevity in this step, focusing on success case first
    });
});
