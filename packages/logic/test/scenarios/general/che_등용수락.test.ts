import { describe, expect, it } from 'vitest';
import type { General, Nation } from '../../../src/domain/entities.js';
import { buildScenarioBootstrap } from '../../../src/world/bootstrap.js';
import { InMemoryWorld, TestGameRunner } from '../../testEnv.js';
import { evaluateActionConstraints } from '../../../src/constraints/evaluate.js';
import type { TurnCommandEnv } from '../../../src/actions/turn/commandEnv.js';
import type { ConstraintContext, RequirementKey, StateView } from '../../../src/constraints/types.js';

const MOCK_SCENARIO_BASE = {
    title: 'Test',
    startYear: 200,
    life: null,
    fiction: 0,
    history: [],
    ignoreDefaultEvents: false,
    nations: [],
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
        environment: { mapName: 'minimal_map', unitSet: 'test_set' },
    },
};

const MINIMAL_MAP = {
    id: 'minimal_map',
    name: 'Minimal Map',
    cities: [
        {
            id: 101,
            name: 'Capital1',
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [],
            max: {} as any,
            initial: {} as any,
        },
        {
            id: 102,
            name: 'Capital2',
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [],
            max: {} as any,
            initial: {} as any,
        },
    ],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

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

function createConstraintContext(actorId: number, cityId: number, nationId: number, args: any = {}): ConstraintContext {
    return {
        actorId,
        cityId,
        nationId,
        args,
        env: {
            ...systemEnv,
            world: { currentYear: 200 },
            openingPartYear: systemEnv.openingPartYear,
            map: MINIMAL_MAP,
            cities: MINIMAL_MAP.cities,
        },
        mode: 'full',
    };
}

function createViewState(world: InMemoryWorld, year: number = 200, env: TurnCommandEnv = systemEnv): StateView {
    return {
        has: (req: RequirementKey) => {
            if (req.kind === 'general') return world.getGeneral(req.id) !== undefined;
            if (req.kind === 'destGeneral') return world.getGeneral(req.id) !== undefined;
            if (req.kind === 'nation') return world.getNation(req.id) !== undefined;
            if (req.kind === 'destNation') return world.getNation(req.id) !== undefined;
            if (req.kind === 'city') return world.snapshot.cities.some((c) => c.id === req.id);
            if (req.kind === 'destCity') return world.snapshot.cities.some((c) => c.id === req.id);
            if (req.kind === 'generalList') return true;
            if (req.kind === 'nationList') return true;
            if (req.kind === 'env') return true;
            return false;
        },
        get: (req: RequirementKey) => {
            if (req.kind === 'general') return world.getGeneral(req.id) || null;
            if (req.kind === 'destGeneral') return world.getGeneral(req.id) || null;
            if (req.kind === 'nation') return world.getNation(req.id) || null;
            if (req.kind === 'destNation') return world.getNation(req.id) || null;
            if (req.kind === 'city') return world.snapshot.cities.find((c) => c.id === req.id) || null;
            if (req.kind === 'destCity') return world.snapshot.cities.find((c) => c.id === req.id) || null;
            if (req.kind === 'generalList') return world.getAllGenerals();
            if (req.kind === 'nationList') return world.snapshot.nations;
            if (req.kind === 'env') {
                if (req.key === 'world') return { currentYear: year };
                if (req.key === 'openingPartYear') return env.openingPartYear;
                if (req.key === 'relYear') return year - 189;
                if (req.key === 'year') return year;
                if (req.key === 'map') return MINIMAL_MAP;
                if (req.key === 'cities') return MINIMAL_MAP.cities;
            }
            return null;
        },
    };
}

describe('che_등용수락', () => {
    it('should success accepting scout from neutral status', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: MINIMAL_MAP,
            options: { defaultGeneralGold: 1000 },
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        const neutralGen: General = {
            id: 1,
            name: 'Neutral',
            nationId: 0,
            cityId: 101,
            troopId: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 0,
            dedication: 0,
            officerLevel: 0,
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null },
            },
            injury: 0,
            gold: 1000,
            rice: 1000,
            crew: 0,
            crewTypeId: 0,
            train: 0,
            atmos: 0,
            age: 20,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        };

        const recruiterGen: General = {
            id: 2,
            name: 'Recruiter',
            nationId: 2,
            cityId: 102,
            troopId: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 0,
            dedication: 0,
            officerLevel: 1,
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null },
            },
            injury: 0,
            gold: 1000,
            rice: 1000,
            crew: 0,
            crewTypeId: 0,
            train: 0,
            atmos: 0,
            age: 20,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        };

        const nation2: Nation = {
            id: 2,
            name: 'Nation2',
            color: '#000',
            capitalCityId: 102,
            chiefGeneralId: 2,
            gold: 0,
            rice: 0,
            power: 0,
            level: 1,
            typeCode: 'che_def',
            meta: {},
        };

        world.snapshot.generals.push(neutralGen);
        world.snapshot.generals.push(recruiterGen);
        world.snapshot.nations.push(nation2);

        const { commandSpec } = await import('../../../src/actions/turn/general/che_등용수락.js');

        await runner.runTurn([
            {
                generalId: neutralGen.id,
                commandKey: 'che_등용수락',
                resolver: commandSpec.createDefinition(systemEnv),
                args: { destNationId: 2, destGeneralId: 2 },
                context: {
                    destNation: nation2,
                    destGeneral: recruiterGen,
                },
            },
        ]);

        const updatedSelf = world.getGeneral(neutralGen.id);
        const updatedRecruiter = world.getGeneral(recruiterGen.id);

        expect(updatedSelf?.nationId).toBe(2);
        expect(updatedSelf?.cityId).toBe(102); // Capital of Nation2
        expect(updatedSelf?.experience).toBe(100);
        expect(updatedSelf?.dedication).toBe(100);

        expect(updatedRecruiter?.experience).toBe(100);
        expect(updatedRecruiter?.dedication).toBe(100);
    });

    it('should success with betrayal (return gold/rice, penalty)', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: MINIMAL_MAP,
            options: { defaultGeneralGold: 1000 },
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        const betrayer: General = {
            id: 1,
            name: 'Betrayer',
            nationId: 1,
            cityId: 101,
            troopId: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 1000,
            dedication: 1000,
            officerLevel: 1,
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null },
            },
            injury: 0,
            gold: 2000,
            rice: 2000,
            crew: 0,
            crewTypeId: 0,
            train: 0,
            atmos: 0,
            age: 20,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: { betray: 1 },
        };
        const nation1: Nation = {
            id: 1,
            name: 'Nation1',
            color: '#000',
            capitalCityId: 101,
            chiefGeneralId: 0,
            gold: 0,
            rice: 0,
            power: 0,
            level: 1,
            typeCode: 'che_def',
            meta: {},
        };

        const recruiterGen: General = {
            id: 2,
            name: 'Recruiter',
            nationId: 2,
            cityId: 102,
            troopId: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 0,
            dedication: 0,
            officerLevel: 1,
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null },
            },
            injury: 0,
            gold: 1000,
            rice: 1000,
            crew: 0,
            crewTypeId: 0,
            train: 0,
            atmos: 0,
            age: 20,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        };
        const nation2: Nation = {
            id: 2,
            name: 'Nation2',
            color: '#000',
            capitalCityId: 102,
            chiefGeneralId: 2,
            gold: 0,
            rice: 0,
            power: 0,
            level: 1,
            typeCode: 'che_def',
            meta: {},
        };

        world.snapshot.generals.push(betrayer);
        world.snapshot.generals.push(recruiterGen);
        world.snapshot.nations.push(nation1);
        world.snapshot.nations.push(nation2);

        const { commandSpec } = await import('../../../src/actions/turn/general/che_등용수락.js');

        await runner.runTurn([
            {
                generalId: betrayer.id,
                commandKey: 'che_등용수락',
                resolver: commandSpec.createDefinition(systemEnv),
                args: { destNationId: 2, destGeneralId: 2 },
                context: {
                    destNation: nation2,
                    destGeneral: recruiterGen,
                },
            },
        ]);

        const updatedSelf = world.getGeneral(betrayer.id);
        const updatedNation1 = world.getNation(1);

        expect(updatedSelf?.nationId).toBe(2);
        expect(updatedSelf?.gold).toBe(1000);
        expect(updatedSelf?.rice).toBe(1000);
        expect(updatedNation1?.gold).toBe(1000);
        expect(updatedNation1?.rice).toBe(1000);
        expect(updatedSelf?.experience).toBe(900);
        expect(updatedSelf?.dedication).toBe(900);
        expect(updatedSelf?.meta.betray).toBe(2);
    });

    it('should deny if monarch', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: MINIMAL_MAP,
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);

        const monarch: General = {
            id: 1,
            name: 'Monarch',
            nationId: 1,
            cityId: 101,
            troopId: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 0,
            dedication: 0,
            officerLevel: 12,
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null },
            },
            injury: 0,
            gold: 1000,
            rice: 1000,
            crew: 0,
            crewTypeId: 0,
            train: 0,
            atmos: 0,
            age: 20,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        };
        const nation1: Nation = {
            id: 1,
            name: 'Nation1',
            color: '#000',
            capitalCityId: 101,
            chiefGeneralId: 1,
            gold: 0,
            rice: 0,
            power: 0,
            level: 1,
            typeCode: 'che_def',
            meta: {},
        };
        const recruiterGen: General = {
            id: 2,
            name: 'Recruiter',
            nationId: 2,
            cityId: 102,
            troopId: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 0,
            dedication: 0,
            officerLevel: 1,
            role: null as any,
            injury: 0,
            gold: 1000,
            rice: 1000,
            crew: 0,
            crewTypeId: 0,
            train: 0,
            atmos: 0,
            age: 20,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        };
        const nation2: Nation = {
            id: 2,
            name: 'Nation2',
            color: '#000',
            capitalCityId: 102,
            chiefGeneralId: 2,
            gold: 0,
            rice: 0,
            power: 0,
            level: 1,
            typeCode: 'che_def',
            meta: {},
        };

        world.snapshot.generals.push(monarch);
        world.snapshot.generals.push(recruiterGen);
        world.snapshot.nations.push(nation1);
        world.snapshot.nations.push(nation2);

        const { commandSpec } = await import('../../../src/actions/turn/general/che_등용수락.js');
        const def = commandSpec.createDefinition(systemEnv);
        const args = { destNationId: 2, destGeneralId: 2 };

        const ctx = createConstraintContext(monarch.id, monarch.cityId, monarch.nationId!, args);
        const view = createViewState(world, 200);

        const result = evaluateActionConstraints(def, ctx, view, args);
        expect(result.kind).toBe('deny');
        if (result.kind === 'deny') {
            expect(result.constraintName).toMatch(/NotLord/i);
        }
    });

    it('should deny if target nation is same as current nation', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: MINIMAL_MAP,
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);

        const general: General = {
            id: 1,
            name: 'Gen1',
            nationId: 1,
            cityId: 101,
            troopId: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 0,
            dedication: 0,
            officerLevel: 1,
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null },
            },
            injury: 0,
            gold: 1000,
            rice: 1000,
            crew: 0,
            crewTypeId: 0,
            train: 0,
            atmos: 0,
            age: 20,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        };
        const nation1: Nation = {
            id: 1,
            name: 'Nation1',
            color: '#000',
            capitalCityId: 101,
            chiefGeneralId: 1,
            gold: 0,
            rice: 0,
            power: 0,
            level: 1,
            typeCode: 'che_def',
            meta: {},
        };
        const recruiterGen: General = {
            id: 2,
            name: 'Recruiter',
            nationId: 1,
            cityId: 101,
            troopId: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 0,
            dedication: 0,
            officerLevel: 1,
            role: null as any,
            injury: 0,
            gold: 1000,
            rice: 1000,
            crew: 0,
            crewTypeId: 0,
            train: 0,
            atmos: 0,
            age: 20,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        };

        world.snapshot.generals.push(general);
        world.snapshot.generals.push(recruiterGen);
        world.snapshot.nations.push(nation1);

        const { commandSpec } = await import('../../../src/actions/turn/general/che_등용수락.js');
        const def = commandSpec.createDefinition(systemEnv);
        const args = { destNationId: 1, destGeneralId: 2 };

        const ctx = createConstraintContext(general.id, general.cityId, general.nationId!, args);
        const view = createViewState(world, 200);

        const result = evaluateActionConstraints(def, ctx, view, args);
        expect(result.kind).toBe('deny');
        if (result.kind === 'deny') {
            expect(result.constraintName).toMatch(/notSameDestNation/i);
        }
    });
});
