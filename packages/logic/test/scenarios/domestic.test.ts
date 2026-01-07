import { describe, expect, it } from 'vitest';
import { MINIMAL_MAP } from '../fixtures/minimalMap.js';
import { InMemoryWorld, TestGameRunner } from '../testEnv.js';
import type { City, General, Nation } from '../../src/domain/entities.js';
import type { WorldSnapshot } from '../../src/world/types.js';
import { commandSpec as developAgricultureSpec } from '../../src/actions/turn/general/che_농지개간.js';
import type { TurnCommandEnv } from '../../src/actions/turn/commandEnv.js';

describe('Domestic Affairs Scenario', () => {
    it('should increase agriculture when executing "Farming" command', async () => {
        // 1. Setup World
        const mockNation: Nation = {
            id: 1,
            name: 'Test Nation',
            color: '#FF0000',
            capitalCityId: 1,
            chiefGeneralId: 1,
            gold: 10000,
            rice: 10000,
            power: 0,
            level: 5,
            typeCode: 'test',
            meta: {},
        };

        const cityDef = MINIMAL_MAP.cities[0];
        if (!cityDef) throw new Error('City definition missing');
        const mockCity: City = {
            id: 1,
            name: cityDef.name,
            nationId: 1,
            level: 1,
            state: 0,
            population: 10000,
            populationMax: 10000,
            agriculture: 500,
            agricultureMax: 1000,
            commerce: 500,
            commerceMax: 1000,
            security: 500,
            securityMax: 1000,
            defence: 500,
            defenceMax: 1000,
            wall: 500,
            wallMax: 1000,
            supplyState: 1,
            frontState: 0,
            meta: {},
        };

        const mockGeneral: General = {
            id: 1,
            name: 'Domestic Officer',
            nationId: 1,
            cityId: 1,
            troopId: 0,
            npcState: 0,
            experience: 100,
            dedication: 100,
            officerLevel: 5,
            gold: 1000,
            rice: 1000,
            crew: 0,
            crewTypeId: 0,
            train: 100,
            atmos: 100,
            injury: 0,
            age: 30,
            stats: { leadership: 50, strength: 50, intelligence: 100 },
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null },
            },
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        };

        const snapshot: WorldSnapshot = {
            scenarioConfig: { environment: { mapName: 'minimal_map', unitSet: 'default' }, options: {} } as any,
            scenarioMeta: {
                title: 'Test',
                startYear: 200,
                life: 0,
                fiction: 0,
                history: [],
                ignoreDefaultEvents: false,
            },
            map: MINIMAL_MAP,
            unitSet: { id: 'default', name: 'default' },
            nations: [mockNation],
            cities: [mockCity],
            generals: [mockGeneral],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };

        const world = new InMemoryWorld(snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        // 2. Prepare Command
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

        const farmingDef = developAgricultureSpec.createDefinition(systemEnv);

        // 3. Execute
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_농지개간',
                resolver: farmingDef,
                args: {},
            },
        ]);

        // 4. Verify
        const updatedCity = world.getCity(1)!;
        console.log(`Agriculture: 500 -> ${updatedCity.agriculture}`);
        expect(updatedCity.agriculture).toBeGreaterThan(500);
    });

    it('should not increase agriculture when city is already maxed', async () => {
        // Setup with max agriculture
        const mockNation: Nation = {
            id: 1,
            name: 'Test Nation',
            color: '#FF0000',
            capitalCityId: 1,
            chiefGeneralId: 1,
            gold: 10000,
            rice: 10000,
            power: 0,
            level: 5,
            typeCode: 'test',
            meta: {},
        };
        const mockCity: City = {
            id: 1,
            name: 'City A',
            nationId: 1,
            level: 1,
            state: 0,
            population: 10000,
            populationMax: 10000,
            agriculture: 1000,
            agricultureMax: 1000,
            commerce: 500,
            commerceMax: 1000,
            security: 500,
            securityMax: 1000,
            defence: 500,
            defenceMax: 1000,
            wall: 500,
            wallMax: 1000,
            supplyState: 1,
            frontState: 0,
            meta: {},
        };
        const mockGeneral: General = {
            id: 1,
            name: 'Domestic Officer',
            nationId: 1,
            cityId: 1,
            troopId: 0,
            npcState: 0,
            experience: 100,
            dedication: 100,
            officerLevel: 5,
            gold: 1000,
            rice: 1000,
            crew: 0,
            crewTypeId: 0,
            train: 100,
            atmos: 100,
            injury: 0,
            age: 30,
            stats: { leadership: 50, strength: 50, intelligence: 100 },
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null },
            },
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        };

        const snapshot: WorldSnapshot = {
            scenarioConfig: { environment: { mapName: 'minimal_map', unitSet: 'default' }, options: {} } as any,
            map: MINIMAL_MAP,
            nations: [mockNation],
            cities: [mockCity],
            generals: [mockGeneral],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };
        const world = new InMemoryWorld(snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        const systemEnv: TurnCommandEnv = { develCost: 50 } as any;
        const farmingDef = developAgricultureSpec.createDefinition(systemEnv);

        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_농지개간',
                resolver: farmingDef,
                args: {},
            },
        ]);

        const updatedCity = world.getCity(1)!;
        expect(updatedCity.agriculture).toBe(1000);
    });
});
