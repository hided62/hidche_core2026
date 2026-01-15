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
            name: 'City1',
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [102],
            max: {} as any,
            initial: {} as any,
        },
        {
            id: 102,
            name: 'City2',
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [101, 103],
            max: {} as any,
            initial: {} as any,
        },
        {
            id: 103,
            name: 'City3',
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [102, 104],
            max: {} as any,
            initial: {} as any,
        },
        {
            id: 104,
            name: 'City4',
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [103, 105],
            max: {} as any,
            initial: {} as any,
        },
        {
            id: 105,
            name: 'City5',
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [104],
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
            develCost: 10,
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
                if (req.key === 'develCost') return 10;
            }
            return null;
        },
    };
}

describe('che_강행', () => {
    it('should allow forced move to nearby city', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: LINEAR_MAP,
            options: { defaultGeneralGold: 1000, defaultGeneralRice: 1000 },
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        const general: General = {
            id: 1,
            name: 'Mover',
            nationId: 1,
            cityId: 101,
            troopId: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 1000,
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
            train: 50,
            atmos: 50,
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

        // Move 101 -> 104 (dist 3) OK
        const definition = (await import('../../../src/actions/turn/general/che_강행.js')).commandSpec.createDefinition(
            {
                scenarioConfig: { const: { develCost: 10 } } as any,
                worldRef: { listGenerals: () => world.getAllGenerals() } as any, // Mock world ref context
                map: LINEAR_MAP,
            } as any
        );

        await runner.runTurn([
            {
                generalId: general.id,
                commandKey: 'che_강행',
                resolver: definition,
                args: { destCityId: 104 },
                context: {
                    map: LINEAR_MAP,
                    startDevelCost: 10,
                },
            },
        ]);

        const updated = world.getGeneral(general.id);
        expect(updated?.cityId).toBe(104);
        expect(updated?.train).toBe(45);
        expect(updated?.atmos).toBe(45);
        // Cost: 10 * 5 = 50. Gold 1000 -> 950.
        expect(updated?.gold).toBe(950);
        expect(updated?.experience).toBe(1100);
        expect(updated?.meta.leadership_exp).toBe(1);
    });

    it('should deny move to far city', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: LINEAR_MAP,
            options: { defaultGeneralGold: 1000 },
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);

        const general: General = {
            id: 1,
            name: 'Mover',
            nationId: 1,
            cityId: 101,
            troopId: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 1000,
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
            train: 50,
            atmos: 50,
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

        // Move 101 -> 105 (dist 4) Fail
        const definition = (await import('../../../src/actions/turn/general/che_강행.js')).commandSpec.createDefinition(
            {
                scenarioConfig: { const: { develCost: 10 } } as any,
                worldRef: { listGenerals: () => world.getAllGenerals() } as any,
                map: LINEAR_MAP,
            } as any
        );

        // Manual constraint check
        const args = { destCityId: 105 };
        const ctx = createConstraintContext(general, 200, args);
        // destCityId in ctx: helpers resolve it from args.
        const view = createViewState(world, 200);

        const result = evaluateActionConstraints(definition, ctx, view, args);

        expect(result.kind).toBe('deny');
        if (result.kind === 'deny') {
            // nearCity failure
            expect(result.constraintName).toBe('nearCity');
        }
    });

    it('should move subordinates if roaming leader', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: LINEAR_MAP,
            options: { defaultGeneralGold: 1000 },
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        const leader: General = {
            id: 1,
            name: 'Leader',
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
            train: 50,
            atmos: 50,
            age: 20,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        };

        const sub: General = {
            id: 2,
            name: 'Sub',
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
            train: 50,
            atmos: 50,
            age: 20,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        };

        const nation: Nation = {
            id: 1,
            name: 'RoamingNation',
            color: '#000',
            capitalCityId: 101,
            chiefGeneralId: 1,
            gold: 0,
            rice: 0,
            power: 0,
            level: 0, // Roaming
            typeCode: 'che_def',
            meta: {},
        };

        world.snapshot.generals.push(leader);
        world.snapshot.generals.push(sub);
        world.snapshot.nations.push(nation);

        const definition = (await import('../../../src/actions/turn/general/che_강행.js')).commandSpec.createDefinition(
            {
                scenarioConfig: { const: { develCost: 10 } } as any,
                worldRef: { listGenerals: () => world.getAllGenerals() } as any, // Must return valid list
                map: LINEAR_MAP,
            } as any
        );

        await runner.runTurn([
            {
                generalId: leader.id,
                commandKey: 'che_강행',
                resolver: definition,
                args: { destCityId: 102 },
                context: {
                    map: LINEAR_MAP,
                    startDevelCost: 10,
                    moveGenerals: world.getAllGenerals(),
                },
            },
        ]);

        const updatedLeader = world.getGeneral(leader.id);
        const updatedSub = world.getGeneral(sub.id);
        expect(updatedLeader?.cityId).toBe(102);
        expect(updatedSub?.cityId).toBe(102);
    });
});
