import { describe, expect, it } from 'vitest';
import { MINIMAL_MAP } from '../fixtures/minimalMap.js';
import { InMemoryWorld, TestGameRunner } from '../testEnv.js';
import type { City, General, Nation } from '../../src/domain/entities.js';
import type { WorldSnapshot } from '../../src/world/types.js';
import { commandSpec as procureSpec } from '../../src/actions/turn/general/che_물자조달.js';
import { commandSpec as donateSpec } from '../../src/actions/turn/general/che_헌납.js';
import { commandSpec as moveSpec } from '../../src/actions/turn/general/che_이동.js';
import { commandSpec as wanderSpec } from '../../src/actions/turn/general/che_방랑.js';
import { commandSpec as resignSpec } from '../../src/actions/turn/general/che_하야.js';
import { commandSpec as retireSpec } from '../../src/actions/turn/general/che_은퇴.js';
import { commandSpec as employSpec } from '../../src/actions/turn/general/che_등용.js';
import { commandSpec as spySpec } from '../../src/actions/turn/general/che_첩보.js';
import { commandSpec as destroySpec } from '../../src/actions/turn/general/che_파괴.js';
import { commandSpec as agitateSpec } from '../../src/actions/turn/general/che_선동.js';
import { commandSpec as seizeSpec } from '../../src/actions/turn/general/che_탈취.js';
import type { TurnCommandEnv } from '../../src/actions/turn/commandEnv.js';

describe('General Commands New Scenario', () => {
    // 1. Setup Environment
    const systemEnv: TurnCommandEnv = {
        develCost: 100,
        trainDelta: 35,
        atmosDelta: 35,
        maxTrainByCommand: 100,
        maxAtmosByCommand: 100,
        sabotageDefaultProb: 0.5,
        sabotageProbCoefByStat: 0.1,
        sabotageDefenceCoefByGeneralCount: 0.1,
        sabotageDamageMin: 10,
        sabotageDamageMax: 30,
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

    it('should execute procure, donate, move, and status changes', async () => {
        const mockNation: Nation = {
            id: 1,
            name: 'Nation A',
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

        const city1: City = {
            id: 1,
            name: 'City 1',
            nationId: 1,
            level: 1,
            state: 0,
            population: 50000,
            populationMax: 50000,
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
            meta: { trust: 50 },
        };

        // City 2 (Neighbor)
        const city2: City = {
            id: 2,
            name: 'City 2',
            nationId: 1,
            level: 1,
            state: 0,
            population: 50000,
            populationMax: 50000,
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
            meta: { trust: 50 },
        };

        const general1: General = {
            id: 1,
            name: 'General 1',
            nationId: 1,
            cityId: 1,
            troopId: 0,
            npcState: 0,
            experience: 100,
            dedication: 100,
            officerLevel: 12, // Lord
            gold: 1000,
            rice: 1000,
            crew: 0,
            crewTypeId: 1,
            train: 10,
            atmos: 10,
            injury: 0,
            age: 30,
            stats: { leadership: 80, strength: 80, intelligence: 80 },
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
            unitSet: { id: 'default', name: 'default', crewTypes: [] } as any,
            nations: [mockNation],
            cities: [city1, city2],
            generals: [general1],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };

        const world = new InMemoryWorld(snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        // 1. Procure
        const procureDef = procureSpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_물자조달',
                resolver: procureDef,
                args: { isGold: true },
                context: {
                    rng: {
                        real: () => 0.9,
                        int: (min: number, _max: number) => min,
                        nextInt: (min: number, _max: number) => min,
                        next: () => 0.9,
                        nextBool: () => true,
                        nextRange: (_min: number, max: number) => max,
                        nextRangeInt: (_min: number, max: number) => max,
                        nextFloat: () => 0.9, // Ensure success
                    },
                },
            },
        ]);

        const n1_after_procure = world.getNation(1)!;
        // Nation gains gold
        expect(n1_after_procure.gold).toBeGreaterThan(10000);

        // 2. Donate
        const donateDef = donateSpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_헌납',
                resolver: donateDef,
                args: { isGold: true, amount: 100 },
            },
        ]);

        const g1_after_donate = world.getGeneral(1)!;
        const n1_after_donate = world.getNation(1)!;
        expect(g1_after_donate.gold).toBe(900); // 1000 - 100 (Procure cost 0)
        expect(n1_after_donate.gold).toBeGreaterThan(10100); // 10000 + Procure + 100

        // 3. Move
        const moveDef = moveSpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_이동',
                resolver: moveDef,
                args: { destCityId: 2 },
                context: { map: MINIMAL_MAP }, // Needed for ConnectedCity check
            },
        ]);

        const g1_after_move = world.getGeneral(1)!;
        expect(g1_after_move.cityId).toBe(2);

        // 4. Wander (Must be Lord)
        const wanderDef = wanderSpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_방랑',
                resolver: wanderDef,
                args: {},
            },
        ]);

        const n1_after_wander = world.getNation(1)!;
        expect(n1_after_wander.level).toBe(0);
        expect(n1_after_wander.typeCode).toBe('None');

        // 5. Resign
        const resignDef = resignSpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_하야',
                resolver: resignDef,
                args: {},
            },
        ]);

        const g1_after_resign = world.getGeneral(1)!;
        expect(g1_after_resign.nationId).toBe(0);

        // 6. Retire (Needs age >= 60)
        // Manually set age
        // Manually set age
        const gToRetire = { ...g1_after_resign, age: 65 };
        world.snapshot.generals = world.snapshot.generals.map((g) => (g.id === 1 ? gToRetire : g));
        const retireDef = retireSpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_은퇴',
                resolver: retireDef,
                args: {},
            },
        ]);

        const g1_after_retire = world.getGeneral(1)!;
        expect(g1_after_retire.age).toBe(20);
        expect(g1_after_retire.experience).toBe(0);
    });

    it('should execute employ and sabotage commands', async () => {
        // Setup: General 1 (Nation 1) -> General 2 (Nation 2) / City 2 (Nation 2)
        const nation1: Nation = {
            id: 1,
            name: 'N1',
            color: 'red',
            capitalCityId: 1,
            chiefGeneralId: 1,
            gold: 1000,
            rice: 1000,
            power: 0,
            level: 1,
            typeCode: 'test',
            meta: {},
        };
        const nation2: Nation = {
            id: 2,
            name: 'N2',
            color: 'blue',
            capitalCityId: 2,
            chiefGeneralId: 2,
            gold: 5000,
            rice: 5000,
            power: 0,
            level: 1,
            typeCode: 'test',
            meta: {},
        };

        const city1: City = {
            id: 1,
            name: 'C1',
            nationId: 1,
            level: 1,
            state: 0,
            population: 1000,
            populationMax: 1000,
            agriculture: 1000,
            agricultureMax: 1000,
            commerce: 1000,
            commerceMax: 1000,
            security: 1000,
            securityMax: 1000,
            defence: 1000,
            defenceMax: 1000,
            wall: 1000,
            wallMax: 1000,
            supplyState: 1,
            frontState: 0,
            meta: { trust: 100 },
        };
        // City 2 is target
        const city2: City = {
            id: 2,
            name: 'C2',
            nationId: 2,
            level: 1,
            state: 0,
            population: 1000,
            populationMax: 1000,
            agriculture: 1000,
            agricultureMax: 1000,
            commerce: 1000,
            commerceMax: 1000,
            security: 1000,
            securityMax: 1000,
            defence: 1000,
            defenceMax: 1000,
            wall: 1000,
            wallMax: 1000,
            supplyState: 1,
            frontState: 0,
            meta: { trust: 100 },
        };

        const gen1: General = { id: 1, name: 'G1', nationId: 1, cityId: 1, troopId: 0, npcState: 0, ticket: 0 } as any;
        Object.assign(gen1, {
            experience: 100,
            dedication: 100,
            officerLevel: 5,
            gold: 5000,
            rice: 5000,
            crew: 0,
            train: 0,
            atmos: 0,
            injury: 0,
            age: 20,
            stats: { leadership: 80, strength: 80, intelligence: 80 },
            role: { personality: null, items: {} },
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        });

        const gen2: General = { id: 2, name: 'G2', nationId: 2, cityId: 2, troopId: 0, npcState: 0, ticket: 0 } as any;
        Object.assign(gen2, {
            experience: 100,
            dedication: 100,
            officerLevel: 5,
            gold: 5000,
            rice: 5000,
            crew: 0,
            train: 0,
            atmos: 0,
            injury: 0,
            age: 20,
            stats: { leadership: 80, strength: 80, intelligence: 80 },
            role: { personality: null, items: {} },
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        });

        const snapshot: WorldSnapshot = {
            scenarioConfig: {} as any,
            scenarioMeta: {} as any,
            map: MINIMAL_MAP,
            unitSet: {} as any,
            nations: [nation1, nation2],
            cities: [city1, city2],
            generals: [gen1, gen2],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };

        const world = new InMemoryWorld(snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        // 1. Employ (G1 -> G2)
        const employDef = employSpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_등용',
                resolver: employDef,
                args: { destGeneralId: 2 },
                context: { destGeneral: gen2, env: systemEnv }, // Manual inject for resolver context
            },
        ]);

        // Verify Logs? (Runner doesn't expose logs easily, but we checks no throw)

        // 2. Spy (G1 -> C2)
        const spyDef = spySpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_첩보',
                resolver: spyDef,
                args: { destCityId: 2 },
                context: { destCity: city2, env: systemEnv, map: MINIMAL_MAP },
            },
        ]);

        const n1_after_spy = world.getNation(1)!;
        const spyInfo = n1_after_spy.meta.spy as any;
        expect(spyInfo['2']).toBe(3); // City 2 spied level 3

        // 3. Destroy (G1 -> C2)
        const destroyDef = destroySpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_파괴',
                resolver: destroyDef,
                args: { destCityId: 2 },
                context: { destCity: city2, env: systemEnv },
            },
        ]);

        const c2_after_destroy = world.getCity(2)!;
        expect(c2_after_destroy.defence).toBeLessThan(1000);
        expect(c2_after_destroy.state).toBe(32);

        // 4. Agitate (G1 -> C2)
        const agitateDef = agitateSpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_선동',
                resolver: agitateDef,
                args: { destCityId: 2 },
                context: { destCity: city2, env: systemEnv },
            },
        ]);

        const c2_after_agitate = world.getCity(2)!;
        const trust = c2_after_agitate.meta.trust as number;
        expect(trust).toBeLessThan(100);
        expect(c2_after_agitate.security).toBeLessThan(1000);

        // 5. Seize (G1 -> C2)
        const seizeDef = seizeSpec.createDefinition(systemEnv);
        // Ensure C2 is supplied (nation has gold/rice)
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_탈취',
                resolver: seizeDef,
                args: { destCityId: 2 },
                context: { destCity: city2, destNation: nation2, env: systemEnv },
            },
        ]);

        const n2_after_seize = world.getNation(2)!;
        expect(n2_after_seize.gold).toBeLessThan(5000); // Stolen from nation

        const g1_after_seize = world.getGeneral(1)!;

        expect(g1_after_seize.gold).toBeGreaterThan(4000); // Cost deducted multiple times
    });
});
