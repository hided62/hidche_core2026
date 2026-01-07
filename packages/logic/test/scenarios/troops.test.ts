
import { describe, expect, it } from 'vitest';
import { MINIMAL_MAP } from '../fixtures/minimalMap.js';
import { InMemoryWorld, TestGameRunner } from '../testEnv.js';
import type { City, General, Nation } from '../../src/domain/entities.js';
import type { WorldSnapshot } from '../../src/world/types.js';
import { commandSpec as draftSpec } from '../../src/actions/turn/general/che_징병.js';
import { commandSpec as trainSpec } from '../../src/actions/turn/general/che_훈련.js';
import { commandSpec as moraleSpec } from '../../src/actions/turn/general/che_사기진작.js';
import type { TurnCommandEnv } from '../../src/actions/turn/commandEnv.js';

describe('Troop Management Scenario', () => {
    it('should successfully draft troops, then train and boost morale', async () => {
        // 1. Setup
        const NATION_ID = 1;
        const CITY_ID = 1;
        const GENERAL_ID = 1;

        const mockNation: Nation = {
            id: NATION_ID,
            name: 'TroopNation',
            color: '#00FF00',
            capitalCityId: CITY_ID,
            chiefGeneralId: GENERAL_ID,
            gold: 50000,
            rice: 50000,
            power: 0,
            level: 3,
            typeCode: 'test',
            meta: { tech: 5000 } // High tech
        };

        const cityDef = MINIMAL_MAP.cities.find(c => c.id === CITY_ID)!;
        const mockCity: City = {
            id: CITY_ID,
            name: cityDef.name,
            nationId: NATION_ID,
            level: cityDef.level,
            region: cityDef.region,
            state: 0,
            population: 50000, // Increased to meet minimum drafting population (30000+)
            populationMax: cityDef.max.population,
            agriculture: 1000,
            agricultureMax: cityDef.max.agriculture,
            commerce: 1000,
            commerceMax: cityDef.max.commerce,
            security: 1000,
            securityMax: cityDef.max.security,
            defence: 500,
            defenceMax: cityDef.max.defence,
            wall: 500,
            wallMax: cityDef.max.wall,
            supplyState: 1,
            frontState: 0,
            trust: 100,
            trade: 100,
            meta: {}
        };

        // General starts with 0 troops but high leadership
        const mockGeneral: General = {
            id: GENERAL_ID,
            name: 'Commander T',
            nationId: NATION_ID,
            cityId: CITY_ID,
            troopId: 0,
            npcState: 0,
            experience: 100,
            dedication: 100,
            officerLevel: 5,
            gold: 3000,
            rice: 3000,
            crew: 0,
            crewTypeId: 1, // Basic infantry (assuming 1 is valid)
            train: 10,
            atmos: 10,
            injury: 0,
            age: 25,
            stats: {
                leadership: 95,
                strength: 80,
                intelligence: 80,
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

        // Simple UnitSet for test
        const unitSet = {
            id: 'default',
            name: 'Default',
            crewTypes: [
                {
                    id: 1,
                    armType: 1,
                    name: '보병',
                    attack: 10,
                    defence: 10,
                    speed: 10,
                    avoid: 0,
                    magicCoef: 0,
                    cost: 10,
                    rice: 1,
                    requirements: [],
                    attackCoef: {},
                    defenceCoef: {},
                    info: [],
                    initSkillTrigger: [],
                    phaseSkillTrigger: [],
                    iActionList: []
                }
            ]
        };

        const snapshot: WorldSnapshot = {
            scenarioConfig: { environment: { mapName: 'minimal_map', unitSet: 'default' }, options: {} } as any,
            scenarioMeta: { title: 'Test', startYear: 200, life: 0, fiction: 0, history: [], ignoreDefaultEvents: false },
            map: MINIMAL_MAP,
            unitSet: unitSet as any,
            nations: [mockNation],
            cities: [mockCity],
            generals: [mockGeneral],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: []
        };

        const world = new InMemoryWorld(snapshot);
        const runner = new TestGameRunner(world, 201, 1);
        const env: TurnCommandEnv = {
            general: mockGeneral,
            date: new Date(201, 0, 1),
            unitSet: unitSet as any
        };

        const draftDef = draftSpec.createDefinition(env);
        const trainDef = trainSpec.createDefinition(env);
        const moraleDef = moraleSpec.createDefinition(env);

        // Step 1: Draft command (args usually amount=0 means max or specific amount)
        // Let's assume drafting 1000 troops.
        // We need to check draft command args. `che_징병.ts` implementation details?
        // Assuming { amount: 1000 } or similar.
        // Let's check `che_징병.ts` args type if possible later, but standard is `amount: number`.

        await runner.runTurn([{
            generalId: GENERAL_ID,
            commandKey: 'che_징병',
            resolver: draftDef,
            args: {
                amount: 1000,
                crewType: 1 // Must specify crewType
            }
        }]);

        let general = world.getGeneral(GENERAL_ID)!;
        expect(general.crew).toBeGreaterThan(0);
        console.log(`Drafted: ${general.crew}`);
        const draftedCrew = general.crew;

        // Step 2: Update env with new general state (important for constraints/logic that depends on current state)
        env.general = general;

        // Step 3: Train command
        await runner.runTurn([{
            generalId: GENERAL_ID,
            commandKey: 'che_훈련',
            resolver: trainDef,
            args: {}
        }]);

        general = world.getGeneral(GENERAL_ID)!;
        expect(general.train).toBeGreaterThan(10);
        console.log(`Train: 10 -> ${general.train}`);

        env.general = general;

        // Step 4: Morale boost
        await runner.runTurn([{
            generalId: GENERAL_ID,
            commandKey: 'che_사기진작',
            resolver: moraleDef,
            args: {}
        }]);

        general = world.getGeneral(GENERAL_ID)!;
        expect(general.atmos).toBeGreaterThan(10);
        console.log(`Atmos: 10 -> ${general.atmos}`);
    });
});
