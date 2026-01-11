import { describe, expect, it } from 'vitest';
import type { General, Nation } from '../../../src/domain/entities.js';
import { buildScenarioBootstrap } from '../../../src/world/bootstrap.js';
import { InMemoryWorld, TestGameRunner } from '../../testEnv.js';
import type { MapDefinition } from '../../../src/world/types.js';
import type { TurnCommandEnv } from '../../../src/actions/turn/commandEnv.js';
import type { ConstraintContext, RequirementKey, StateView } from '../../../src/constraints/types.js';
import { evaluateActionConstraints } from '../../../src/constraints/evaluate.js';

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
        environment: { mapName: 'custom_map', unitSet: 'test_set' },
    },
};

const LINEAR_MAP: MapDefinition = {
    id: 'linear_map',
    name: 'Linear Map',
    cities: [
        {
            id: 101,
            name: 'CapitalCity',
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [102],
            max: {} as any,
            initial: {} as any,
        },
        {
            id: 102,
            name: 'OtherCity',
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [101, 103],
            max: {} as any,
            initial: {} as any,
        },
        {
            id: 103,
            name: 'OfficerCity',
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [102],
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

function createConstraintContext(actor: General, year: number = 200, args: any = {}): ConstraintContext {
    return {
        actorId: actor.id,
        cityId: actor.cityId,
        nationId: actor.nationId || 0,
        args,
        env: {
            ...systemEnv,
            world: { currentYear: year },
            openingPartYear: systemEnv.openingPartYear,
            map: LINEAR_MAP,
            cities: LINEAR_MAP.cities,
        },
        mode: 'full',
    };
}

function createViewState(world: InMemoryWorld, year: number = 200, env: TurnCommandEnv = systemEnv): StateView {
    return {
        has: (req: RequirementKey) => {
            if (req.kind === 'general') return world.getGeneral(req.id) !== undefined;
            if (req.kind === 'nation') return world.getNation(req.id) !== undefined;
            if (req.kind === 'city') return world.snapshot.cities.some((c) => c.id === req.id);
            if (req.kind === 'destCity') {
                return world.snapshot.cities.some((c) => c.id === req.id);
            }
            if (req.kind === 'generalList') return true;
            if (req.kind === 'nationList') return true;
            if (req.kind === 'env') return true;
            return false;
        },
        get: (req: RequirementKey) => {
            if (req.kind === 'general') return world.getGeneral(req.id) || null;
            if (req.kind === 'nation') return world.getNation(req.id) || null;
            if (req.kind === 'city') return world.snapshot.cities.find((c) => c.id === req.id) || null;
            if (req.kind === 'destCity') return world.snapshot.cities.find((c) => c.id === req.id) || null;
            if (req.kind === 'generalList') return world.getAllGenerals();
            if (req.kind === 'nationList') return world.snapshot.nations;
            if (req.kind === 'env') {
                if (req.key === 'world') return { currentYear: year };
                if (req.key === 'openingPartYear') return env.openingPartYear;
                if (req.key === 'relYear') return year - 189;
                if (req.key === 'year') return year;
                if (req.key === 'map') return LINEAR_MAP;
                if (req.key === 'cities') return LINEAR_MAP.cities;
            }
            return null;
        },
    };
}

describe('che_귀환', () => {
    it('should return to capital if normal officer', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: LINEAR_MAP,
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        const general: General = {
            id: 1,
            name: 'NormalOfficer',
            nationId: 1,
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
        const nation: Nation = {
            id: 1,
            name: 'MyNation',
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
        world.snapshot.generals.push(general);
        world.snapshot.nations.push(nation);

        await runner.runTurn([
            {
                generalId: general.id,
                commandKey: 'che_귀환',
                resolver: (await import('../../../src/actions/turn/general/che_귀환.js')).commandSpec.createDefinition(
                    {} as any
                ),
                args: {},
            },
        ]);

        const updated = world.getGeneral(general.id);
        expect(updated?.cityId).toBe(101); // Capital
        expect(updated?.experience).toBe(70);
        expect(updated?.dedication).toBe(100);
        expect(updated?.meta.leadership_exp).toBe(1);

        // Check log?
    });

    it('should return to officer_city if level 4', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: LINEAR_MAP,
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        const general: General = {
            id: 1,
            name: 'Governor',
            nationId: 1,
            cityId: 102,
            troopId: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 0,
            dedication: 0,
            officerLevel: 4,
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
            meta: { officer_city: 103 },
        };
        const nation: Nation = {
            id: 1,
            name: 'MyNation',
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
        world.snapshot.generals.push(general);
        world.snapshot.nations.push(nation);

        await runner.runTurn([
            {
                generalId: general.id,
                commandKey: 'che_귀환',
                resolver: (await import('../../../src/actions/turn/general/che_귀환.js')).commandSpec.createDefinition(
                    {} as any
                ),
                args: {},
            },
        ]);

        const updated = world.getGeneral(general.id);
        expect(updated?.cityId).toBe(103); // Officer City
    });

    it('should deny if already in capital', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: LINEAR_MAP,
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);

        const general: General = {
            id: 1,
            name: 'AlreadyHome',
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
        const nation: Nation = {
            id: 1,
            name: 'MyNation',
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
        world.snapshot.generals.push(general);
        world.snapshot.nations.push(nation);

        const def = (await import('../../../src/actions/turn/general/che_귀환.js')).commandSpec.createDefinition(
            {} as any
        );
        const args = {};

        const ctx = createConstraintContext(general, 200, args);
        const view = createViewState(world, 200);

        const result = evaluateActionConstraints(def, ctx, view, args);

        expect(result.kind).toBe('deny');
        if (result.kind === 'deny') {
            expect(result.constraintName).toBe('notCapital');
        }
    });

    it('should deny if already in officer city (if logic applies)', async () => {
        // Since notCapital(true) checks CAPITAL, not destination.
        // Legacy: "notCapital(true)" means "is in capital?".
        // If officer returns to officer_city, but Is Not In Capital, does it allow?
        // Logic: if(in_capital) deny.
        // If I am in officer_city (103), but capital is 101. I am NOT in capital. Allowed.
        // Wait, if I am in 103, and destination IS 103.
        // `che_귀환` doesn't seem to have `notSameDestCity` constraint!
        // So I can return to my own city if it's not capital?
        // Logic: moves to destCityID. Log "Returned to ...". Adds Exp.
        // If already there, you just get exp?
        // Legacy constraints don't enforce "notSameDestCity".
        // It enforce "NotCapital(true)".
        // So unless I am in capital, I can return.

        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: LINEAR_MAP,
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        const general: General = {
            id: 1,
            name: 'GovernorAtHome',
            nationId: 1,
            cityId: 103,
            troopId: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 0,
            dedication: 0,
            officerLevel: 4,
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
            meta: { officer_city: 103 },
        };
        const nation: Nation = {
            id: 1,
            name: 'MyNation',
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
        world.snapshot.generals.push(general);
        world.snapshot.nations.push(nation);

        // Capital is 101. I am at 103. notCapital(true) passes.
        // Return to 103.

        await runner.runTurn([
            {
                generalId: general.id,
                commandKey: 'che_귀환',
                resolver: (await import('../../../src/actions/turn/general/che_귀환.js')).commandSpec.createDefinition(
                    {} as any
                ),
                args: {},
            },
        ]);

        const updated = world.getGeneral(general.id);
        expect(updated?.cityId).toBe(103);
        expect(updated?.experience).toBe(70); // Gained exp even if moved to same spot
    });
});
