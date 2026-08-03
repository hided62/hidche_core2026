import { describe, expect, it } from 'vitest';
import { MINIMAL_MAP } from '../fixtures/minimalMap.js';
import { InMemoryWorld, TestGameRunner } from '../testEnv.js';
import type { City, General, Nation } from '../../src/domain/entities.js';
import type { WorldSnapshot } from '../../src/world/types.js';
import {
    commandSpec as procureSpec,
    roundLegacyAccumulatedInteger,
} from '../../src/actions/turn/general/che_물자조달.js';
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
import { commandSpec as fireSpec } from '../../src/actions/turn/general/che_화계.js';
import type { TurnCommandEnv } from '../../src/actions/turn/commandEnv.js';
import {
    createItemActionModules,
    createItemModuleRegistry,
    equipNewItem,
    getEquippedItemInstance,
    loadItemModules,
} from '../../src/items/index.js';
import { createRefOrderedActionStack } from '../../src/actionModules/bundle.js';
import type { GeneralActionModule } from '../../src/actionModules/general.js';
import {
    normalizeLegacyGeneratedDex,
    resolveLegacySpecialityAge,
} from '../../src/actions/turn/general/che_인재탐색.js';
import {
    addLegacyStoredTech,
    readLegacyStoredTech,
    toLegacyStoredTech,
} from '../../src/actions/turn/general/che_기술연구.js';
import {
    readLegacyCityTrust,
    storeLegacyCityTrust,
} from '../../src/actions/turn/general/legacyCityTrust.js';
import { roundLegacyRecruitCost } from '../../src/actions/turn/general/che_징병.js';

describe('General Commands New Scenario', () => {
    it('truncates generated NPC dex like GeneralBuilder integer arguments', () => {
        expect(normalizeLegacyGeneratedDex([36.5, 7.9, 7.1, 7.99, 0.75])).toEqual([36, 7, 7, 7, 0]);
    });

    it('rounds the accumulated procurement experience like a MariaDB INT assignment', () => {
        const delta = (45 * 0.7) / 3;
        expect(delta).toBe(10.499999999999998);
        expect(Math.round(delta)).toBe(10);
        expect(roundLegacyAccumulatedInteger(4554, delta)).toBe(4565);
    });

    it('persists generated NPC speciality ages from the legacy creation date', () => {
        expect(resolveLegacySpecialityAge(80, 22, 12)).toBe(27);
        expect(resolveLegacySpecialityAge(80, 22, 6)).toBe(32);
        expect(resolveLegacySpecialityAge(80, 24, 12)).toBe(29);
    });

    it('stores technology as binary32 without per-update decimal quantization', () => {
        const value = 433.51797;
        expect(toLegacyStoredTech(value)).toBe(Math.fround(value));
        expect(toLegacyStoredTech(value)).not.toBe(Number(Math.fround(value).toPrecision(6)));
        expect(readLegacyStoredTech(624.0966796875)).toBe(624.097);
        expect(addLegacyStoredTech(624.0966796875, 22.9)).toBe(Math.fround(624.097 + 22.9));
    });

    it('separates MariaDB FLOAT trust storage from its six-digit PHP read value', () => {
        const stored = storeLegacyCityTrust(88.306755);

        expect(stored).toBe(Math.fround(88.306755));
        expect(stored).not.toBe(readLegacyCityTrust(stored));
        expect(readLegacyCityTrust(stored)).toBe(88.3068);
        expect(readLegacyCityTrust(storeLegacyCityTrust(readLegacyCityTrust(stored) + 10))).toBe(98.3068);
    });

    it('rounds recruitment cost across the PHP half boundary', () => {
        const cavalryCost = (11 * 1.15 * 7000) / 100;

        expect(cavalryCost).toBe(885.4999999999999);
        expect(Math.round(cavalryCost)).toBe(885);
        expect(roundLegacyRecruitCost(cavalryCost)).toBe(886);
    });

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
            meta: { killturn: 24 },
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
        const procureDef = procureSpec.createDefinition({
            ...systemEnv,
            generalActionModules: (() => {
                const noOp = {};
                return createRefOrderedActionStack({
                    nation: noOp,
                    officer: noOp,
                    domestic: noOp,
                    war: noOp,
                    personality: {
                        eventHandlers: {},
                        onCalcStat: (_context, statName, value) => (statName === 'experience' ? value * 1.1 : value),
                    } satisfies GeneralActionModule,
                    crewType: null,
                    inheritance: noOp,
                    scenario: null,
                    items: [],
                });
            })(),
        });
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
                        nextFloat1: () => 0.9, // Ensure success
                    },
                },
            },
        ]);

        const n1_after_procure = world.getNation(1)!;
        const g1_after_procure = world.getGeneral(1)!;
        // Nation gains gold
        expect(n1_after_procure.gold).toBeGreaterThan(10000);
        // Ref's addExperience/addDedication route rewards through onCalcStat.
        expect(g1_after_procure.experience).toBe(183);
        expect(g1_after_procure.dedication).toBe(208);

        // 2. Donate
        const donateDef = donateSpec.createDefinition(systemEnv);
        const expBeforeDonate = world.getGeneral(1)!.experience;
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
        expect(g1_after_donate.experience).toBe(expBeforeDonate + 70);
        expect(g1_after_donate.meta.leadership_exp).toBe(1);
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
        // General::rebirth()는 앞선 명령으로 누적된 경험을 초기화하지 않고 절반으로 줄인다.
        expect(g1_after_retire.experience).toBe(Math.round(gToRetire.experience * 0.5));
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
        equipNewItem(gen1, 'item', 'che_계략_이추');

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
        const itemGeneralModules = createItemActionModules(
            createItemModuleRegistry(await loadItemModules(['che_계략_이추', 'che_계략_향낭']))
        ).general;
        const reEquipStrategyItem = (itemKey: 'che_계략_이추' | 'che_계략_향낭'): void => {
            const nextGeneral = structuredClone(world.getGeneral(1)!);
            equipNewItem(nextGeneral, 'item', itemKey);
            world.snapshot.generals = world.snapshot.generals.map((general) =>
                general.id === nextGeneral.id ? nextGeneral : general
            );
        };

        // 1. Employ (G1 -> G2)
        const employDef = employSpec.createDefinition(systemEnv);
        const goldBeforeEmploy = world.getGeneral(1)!.gold;
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_등용',
                resolver: employDef,
                args: { destGeneralId: 2 },
                context: { destGeneral: gen2, env: systemEnv }, // Manual inject for resolver context
            },
        ]);
        // 레거시 비용: round(develcost + (대상 경험 + 공헌) / 1000) * 10.
        expect(world.getGeneral(1)!.gold).toBe(goldBeforeEmploy - 1_000);

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
        const noOpModule = {};
        const strategyEnv: TurnCommandEnv = {
            ...systemEnv,
            generalActionModules: createRefOrderedActionStack({
                nation: noOpModule,
                officer: noOpModule,
                domestic: noOpModule,
                war: noOpModule,
                personality: noOpModule,
                crewType: null,
                inheritance: noOpModule,
                scenario: null,
                items: itemGeneralModules,
            }),
        };
        const destroyDef = destroySpec.createDefinition(strategyEnv);
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
        expect(getEquippedItemInstance(world.getGeneral(1)!, 'item')).toBeNull();

        // 4. Fire attack consumes the successful one-use strategy item.
        reEquipStrategyItem('che_계략_향낭');
        const fireDef = fireSpec.createDefinition(strategyEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_화계',
                resolver: fireDef,
                args: { destCityId: 2 },
                context: {
                    destCity: city2,
                    destNation: nation2,
                    destGenerals: [gen2],
                    env: systemEnv,
                    map: MINIMAL_MAP,
                    rng: {
                        real: () => 0,
                        int: (min: number, _max: number) => min,
                        nextInt: (min: number, _max: number) => min,
                        next: () => 0,
                        nextBool: () => true,
                        nextRange: (min: number, _max: number) => min,
                        nextRangeInt: (min: number, _max: number) => min,
                        nextFloat1: () => 0,
                    },
                },
            },
        ]);
        expect(getEquippedItemInstance(world.getGeneral(1)!, 'item')).toBeNull();
        expect(world.getGeneral(1)!.role.items.item).toBeNull();

        // 5. Agitate (G1 -> C2)
        reEquipStrategyItem('che_계략_이추');
        const agitateDef = agitateSpec.createDefinition(strategyEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_선동',
                resolver: agitateDef,
                args: { destCityId: 2 },
                context: {
                    destCity: city2,
                    destNation: nation2,
                    destGenerals: [gen2],
                    env: systemEnv,
                    rng: {
                        real: () => 0,
                        int: (min: number, _max: number) => min,
                        nextInt: (min: number, _max: number) => min,
                        next: () => 0,
                        nextBool: () => true,
                        nextRange: (min: number, _max: number) => min,
                        nextRangeInt: (min: number, _max: number) => min,
                        nextFloat1: () => 0,
                    },
                },
            },
        ]);

        const c2_after_agitate = world.getCity(2)!;
        const trust = c2_after_agitate.meta.trust as number;
        expect(trust).toBeLessThan(100);
        expect(c2_after_agitate.security).toBeLessThan(1000);
        expect(getEquippedItemInstance(world.getGeneral(1)!, 'item')).toBeNull();

        // 6. Seize (G1 -> C2)
        reEquipStrategyItem('che_계략_향낭');
        const seizeDef = seizeSpec.createDefinition(strategyEnv);
        const goldBeforeSeize = world.getGeneral(1)!.gold;
        // Ensure C2 is supplied (nation has gold/rice)
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_탈취',
                resolver: seizeDef,
                args: { destCityId: 2 },
                context: {
                    destCity: city2,
                    destNation: nation2,
                    destGenerals: [gen2],
                    env: systemEnv,
                    year: 200,
                    startYear: 200,
                    rng: {
                        real: () => 0,
                        int: (min: number, _max: number) => min,
                        nextInt: (min: number, _max: number) => min,
                        next: () => 0,
                        nextBool: () => true,
                        nextRange: (min: number, _max: number) => min,
                        nextRangeInt: (min: number, _max: number) => min,
                        nextFloat1: () => 0,
                    },
                },
            },
        ]);

        const n2_after_seize = world.getNation(2)!;
        expect(n2_after_seize.gold).toBeLessThan(5000); // Stolen from nation

        const g1_after_seize = world.getGeneral(1)!;

        // 레거시는 개발비의 5배를 먼저 소모한 뒤 탈취량의 30%를 개인 몫으로 지급한다.
        expect(g1_after_seize.gold).toBe(goldBeforeSeize - systemEnv.develCost * 5 + 1);
        expect(getEquippedItemInstance(g1_after_seize, 'item')).toBeNull();
    });
});
