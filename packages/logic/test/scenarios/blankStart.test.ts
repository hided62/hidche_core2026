import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { MINIMAL_MAP } from '../fixtures/minimalMap.js';
import { InMemoryWorld, TestGameRunner } from '../testEnv.js';
import { buildScenarioBootstrap } from '../../src/world/bootstrap.js';
import type { ScenarioDefinition, ScenarioGeneral } from '../../src/scenario/types.js';
import type { Nation, City, General } from '../../src/domain/entities.js';
import { commandSpec as foundNationSpec } from '../../src/actions/turn/general/che_건국.js';
import { commandSpec as uprisingSpec } from '../../src/actions/turn/general/che_거병.js';
import { commandSpec as appointmentSpec } from '../../src/actions/turn/general/che_임관.js';
import type { TurnCommandEnv } from '../../src/actions/turn/commandEnv.js';
import type { ConstraintContext, RequirementKey, StateView } from '../../src/constraints/types.js';
import { evaluateActionConstraints } from '../../src/constraints/evaluate.js';

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
    draft.generalsNeutral = MOCK_GENERALS;
});

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

describe('Blank Start Scenario', () => {
    function createConstraintContext(actor: General, year: number = 189, args: any = {}): ConstraintContext {
        return {
            actorId: actor.id,
            cityId: actor.cityId,
            nationId: actor.nationId || 0,
            args,
            env: {
                ...systemEnv,
                world: { currentYear: year },
                openingPartYear: systemEnv.openingPartYear,
            },
            mode: 'full',
        };
    }

    function createViewState(world: InMemoryWorld, year: number = 189, env: TurnCommandEnv = systemEnv): StateView {
        return {
            has: (req: RequirementKey) => {
                if (req.kind === 'general') return world.getGeneral(req.id) !== undefined;
                if (req.kind === 'nation') return world.getNation(req.id) !== undefined;
                if (req.kind === 'city') return world.snapshot.cities.some((c) => c.id === req.id);
                if (req.kind === 'generalList') return true;
                if (req.kind === 'nationList') return true;
                if (req.kind === 'env') return true;
                return false;
            },
            get: (req: RequirementKey) => {
                if (req.kind === 'general') return world.getGeneral(req.id) || null;
                if (req.kind === 'nation') return world.getNation(req.id) || null;
                if (req.kind === 'city') return world.snapshot.cities.find((c) => c.id === req.id) || null;
                if (req.kind === 'generalList') return world.getAllGenerals();
                if (req.kind === 'nationList') return world.snapshot.nations;
                if (req.kind === 'env') {
                    if (req.key === 'world') return { currentYear: year };
                    if (req.key === 'openingPartYear') return env.openingPartYear;
                    if (req.key === 'relYear') return year - 189;
                    if (req.key === 'year') return year;
                }
                return null;
            },
        };
    }

    const FOUNDING_ARGS = {
        nationName: 'NewChosen',
        nationType: 'che_def',
        colorType: 1,
    };

    it('should follow the correct founding scenario (uprising -> appointment -> founding)', async () => {
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

        const snapshot = bootstrapResult.snapshot;
        // Ensure initial cities have level 5 or 6 for founding test later
        snapshot.cities = snapshot.cities.map((c) => ({ ...c, level: 5 }));
        const world = new InMemoryWorld(snapshot);
        const runner = new TestGameRunner(world, 189, 1);

        const gen0 = world.getAllGenerals().find((g) => g.name === 'General_0')!;
        const gen1 = world.getAllGenerals().find((g) => g.name === 'General_1')!;

        const foundNationDef = foundNationSpec.createDefinition(systemEnv);
        const uprisingDef = uprisingSpec.createDefinition(systemEnv);
        const appointmentDef = appointmentSpec.createDefinition(systemEnv);

        // --- Step 1: Gen 0 performs Uprising ---
        await runner.runTurn([
            {
                generalId: gen0.id,
                commandKey: 'che_거병',
                resolver: uprisingDef,
                args: {},
            },
        ]);

        const gen0AfterUprising = world.getGeneral(gen0.id)!;
        expect(gen0AfterUprising.nationId).toBeGreaterThan(0);
        expect(gen0AfterUprising.officerLevel).toBe(12);

        const newNationId = gen0AfterUprising.nationId;
        const newNation = world.getNation(newNationId)!;
        expect(newNation.chiefGeneralId).toBe(gen0.id);
        expect(newNation.level).toBe(0); // Wandering Nation

        // --- Step 2: Gen 1 performs Appointment ---
        // Before appointment, Gen 0 should FAIL Founding because general count = 1
        const ctxBefore = createConstraintContext(world.getGeneral(gen0.id)!, 189, FOUNDING_ARGS);
        const viewBefore = createViewState(world, 189, ctxBefore.env as any);
        const resultFailCount = evaluateActionConstraints(foundNationDef, ctxBefore, viewBefore, FOUNDING_ARGS);
        expect(resultFailCount.kind).toBe('deny');
        if (resultFailCount.kind === 'deny') {
            expect(resultFailCount.constraintName).toBe('reqNationGeneralCount');
        }

        await runner.runTurn([
            {
                generalId: gen1.id,
                commandKey: 'che_임관',
                resolver: appointmentDef,
                args: { destNationId: newNationId },
            },
        ]);

        // Simulate Appointment Daemon
        const gen1Idx = world.snapshot.generals.findIndex((g) => g.id === gen1.id);
        world.snapshot.generals[gen1Idx] = {
            ...world.snapshot.generals[gen1Idx],
            nationId: newNationId,
            officerLevel: 1,
        } as General;

        // --- Step 3: Gen 0 performs Founding ---
        // First, check name duplicate
        const duplicateNation: Nation = {
            id: 2,
            name: 'TakenName',
            color: '#00FF00',
            capitalCityId: 2,
            chiefGeneralId: 998,
            gold: 10000,
            rice: 10000,
            power: 0,
            level: 1,
            typeCode: 'che_def',
            meta: {},
        };
        world.snapshot.nations.push(duplicateNation);
        const ctxDuplicate = createConstraintContext(world.getGeneral(gen0.id)!, 189, {
            ...FOUNDING_ARGS,
            nationName: 'TakenName',
        });
        const resDuplicate = evaluateActionConstraints(
            foundNationDef,
            ctxDuplicate,
            createViewState(world, 189, ctxDuplicate.env as any),
            { ...FOUNDING_ARGS, nationName: 'TakenName' }
        );
        expect(resDuplicate.kind).toBe('deny');
        if (resDuplicate.kind === 'deny') {
            expect(resDuplicate.constraintName).toBe('checkNationNameDuplicate');
        }

        // Now it should pass constraints
        const finalGen0 = world.getGeneral(gen0.id)!;
        const finalCtx = createConstraintContext(finalGen0, 189, FOUNDING_ARGS);
        const finalView = createViewState(world, 189, finalCtx.env as any);
        const finalResult = evaluateActionConstraints(foundNationDef, finalCtx, finalView, FOUNDING_ARGS);
        expect(finalResult.kind).toBe('allow');

        await runner.runTurn([
            {
                generalId: gen0.id,
                commandKey: 'che_건국',
                resolver: foundNationDef,
                args: FOUNDING_ARGS,
            },
        ]);

        const nationAfterFounding = world.getNation(newNationId)!;
        expect(nationAfterFounding.level).toBe(1);
        expect(nationAfterFounding.name).toBe(FOUNDING_ARGS.nationName);
        expect(nationAfterFounding.capitalCityId).toBe(gen0.cityId);
    });

    it('should fail founding if city is not level 5 or 6', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: scenarioWithGenerals,
            map: MINIMAL_MAP,
            options: { includeNeutralNation: true, defaultGeneralGold: 1000, defaultGeneralRice: 1000 },
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);
        const gen0 = world.getAllGenerals().find((g) => g.name === 'General_0')!;

        // Setup monarch in wandering nation but city level is 1 (수)
        const newNation: Nation = {
            id: 1,
            name: 'Test',
            color: '#FF0000',
            capitalCityId: gen0.cityId,
            chiefGeneralId: gen0.id,
            gold: 10000,
            rice: 10000,
            power: 0,
            level: 0,
            typeCode: 'che_def',
            meta: {},
        };
        world.snapshot.nations.push(newNation);
        const gen0Idx = world.snapshot.generals.findIndex((g) => g.id === gen0.id);
        world.snapshot.generals[gen0Idx] = { ...gen0, nationId: 1, officerLevel: 12 } as General;

        // Add another general to satisfy reqNationGeneralCount(2)
        const gen1 = world.getAllGenerals().find((g) => g.id !== gen0.id)!;
        const gen1Idx = world.snapshot.generals.findIndex((g) => g.id === gen1.id);
        world.snapshot.generals[gen1Idx] = { ...gen1, nationId: 1 } as General;

        const cityIdx = world.snapshot.cities.findIndex((c) => c.id === gen0.cityId);
        world.snapshot.cities[cityIdx] = { ...world.snapshot.cities[cityIdx], level: 1 } as City;

        const foundNationDef = foundNationSpec.createDefinition(systemEnv);
        const ctx = createConstraintContext(world.getGeneral(gen0.id)!, 189, FOUNDING_ARGS);
        const view = createViewState(world, 189, ctx.env as any);

        const resLevel = evaluateActionConstraints(foundNationDef, ctx, view, FOUNDING_ARGS);
        expect(resLevel.kind).toBe('deny');
        if (resLevel.kind === 'deny') {
            expect(resLevel.constraintName).toBe('reqCityLevel');
        }
    });

    it('should fail founding after opening part', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: scenarioWithGenerals,
            map: MINIMAL_MAP,
            options: { includeNeutralNation: true },
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);
        const gen0 = world.getAllGenerals().find((g) => g.name === 'General_0')!;

        const foundNationDef = foundNationSpec.createDefinition(systemEnv);
        // Setup monarch and enough generals
        const newNation: Nation = {
            id: 1,
            name: 'Test',
            color: '#FF0000',
            capitalCityId: gen0.cityId,
            chiefGeneralId: gen0.id,
            gold: 10000,
            rice: 10000,
            power: 0,
            level: 0,
            typeCode: 'che_def',
            meta: {},
        };
        world.snapshot.nations.push(newNation);
        const gen0Idx = world.snapshot.generals.findIndex((g) => g.id === gen0.id);
        world.snapshot.generals[gen0Idx] = { ...gen0, nationId: 1, officerLevel: 12 } as General;
        const gen1 = world.getAllGenerals().find((g) => g.id !== gen0.id)!;
        const gen1Idx = world.snapshot.generals.findIndex((g) => g.id === gen1.id);
        world.snapshot.generals[gen1Idx] = { ...gen1, nationId: 1 } as General;

        // startYear가 189였음
        const year = 190;
        const ctx = createConstraintContext(world.getGeneral(gen0.id)!, year, FOUNDING_ARGS);
        // OpeningPartYear를 1로 설정하여 189(rel 0)만 허용하고 190(rel 1)은 실패하게 함
        ctx.env.openingPartYear = 1;

        // Ensure city level doesn't block evaluation before beOpeningPart
        const cityIdx = world.snapshot.cities.findIndex((c) => c.id === gen0.cityId);
        world.snapshot.cities[cityIdx] = { ...world.snapshot.cities[cityIdx], level: 5 } as City;

        const view = createViewState(world, year, ctx.env as any);

        const res = evaluateActionConstraints(foundNationDef, ctx, view, FOUNDING_ARGS);
        expect(res.kind).toBe('deny');
        if (res.kind === 'deny') {
            expect(res.constraintName).toBe('beOpeningPart');
        }
    });
});
