import { describe, expect, it } from 'vitest';
import type { General } from '../../../src/domain/entities.js';
import { buildScenarioBootstrap } from '../../../src/world/bootstrap.js';
import type { TurnCommandEnv } from '../../../src/actions/turn/commandEnv.js';
import type { ConstraintContext, RequirementKey, StateView } from '../../../src/constraints/types.js';
import { evaluateActionConstraints } from '../../../src/constraints/evaluate.js';
import { MINIMAL_MAP } from '../../fixtures/minimalMap.js';
import { InMemoryWorld, TestGameRunner } from '../../testEnv.js';

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
            if (req.kind === 'destCity') return world.snapshot.cities.some((c) => c.id === req.id);
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
                if (req.key === 'map') return MINIMAL_MAP;
            }
            return null;
        },
    };
}

describe('che_NPC능동', () => {
    it('should allow NPC to teleport with "순간이동"', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: MINIMAL_MAP,
            options: { defaultGeneralGold: 1000 },
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        // Add NPC General manually to snapshot
        const cityId = MINIMAL_MAP.cities[0]!.id;
        const destCityId = MINIMAL_MAP.cities[1]!.id;

        const general: General = {
            id: 1,
            name: 'NPCGeneral',
            nationId: 0,
            cityId,
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
            npcState: 2, // NPC
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: { killturn: 24 },
        };
        world.snapshot.generals.push(general);

        await runner.runTurn([
            {
                generalId: general.id,
                commandKey: 'che_NPC능동',
                resolver: (
                    await import('../../../src/actions/turn/general/che_NPC능동.js')
                ).commandSpec.createDefinition({} as any),
                args: { optionText: '순간이동', destCityId },
            },
        ]);

        const updated = world.getGeneral(general.id);
        expect(updated?.cityId).toBe(destCityId);
    });

    it('does not reapply the reservation-only NPC permission at execution', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: MINIMAL_MAP,
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);

        const cityId = MINIMAL_MAP.cities[0]!.id;
        const destCityId = MINIMAL_MAP.cities[1]!.id;

        const general: General = {
            id: 1,
            name: 'HumanGeneral',
            nationId: 0,
            cityId,
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
            npcState: 0, // Human
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: { killturn: 24 },
        };
        world.snapshot.generals.push(general);

        const def = (await import('../../../src/actions/turn/general/che_NPC능동.js')).commandSpec.createDefinition(
            {} as any
        );
        const args = { optionText: '순간이동', destCityId };

        const ctx = createConstraintContext(general, 200, args);
        const view = createViewState(world, 200);

        const result = evaluateActionConstraints(def, ctx, view, args);

        expect(result.kind).toBe('allow');

        const runner = new TestGameRunner(world, 200, 1);
        await runner.runTurn([
            {
                generalId: general.id,
                commandKey: 'che_NPC능동',
                resolver: def,
                args,
            },
        ]);

        expect(world.getGeneral(general.id)?.cityId).toBe(destCityId);
    });

    it('rejects a destination that does not exist', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: MINIMAL_MAP,
        });
        const world = new InMemoryWorld(bootstrapResult.snapshot);
        const general = {
            ...world.snapshot.generals[0]!,
            id: 1,
            npcState: 2,
        };
        world.snapshot.generals.push(general);
        const definition = (
            await import('../../../src/actions/turn/general/che_NPC능동.js')
        ).commandSpec.createDefinition({} as TurnCommandEnv);
        const args = { optionText: '순간이동' as const, destCityId: 999_999 };

        const result = evaluateActionConstraints(
            definition,
            createConstraintContext(general, 200, args),
            createViewState(world, 200),
            args
        );

        expect(result).toMatchObject({
            kind: 'deny',
            constraintName: 'existsDestCity',
            reason: '도시 정보가 없습니다.',
        });
    });

    it('rejects structurally invalid command arguments', async () => {
        const definition = (
            await import('../../../src/actions/turn/general/che_NPC능동.js')
        ).commandSpec.createDefinition({} as TurnCommandEnv);

        expect(definition.parseArgs(null)).toBeNull();
        expect(definition.parseArgs({ optionText: '순간이동' })).toBeNull();
        expect(definition.parseArgs({ optionText: '순간이동', destCityId: '101' })).toEqual({
            optionText: '순간이동',
            destCityId: 101,
        });
        expect(definition.parseArgs({ optionText: '순간이동', destCityId: 101.9 })).toEqual({
            optionText: '순간이동',
            destCityId: 101,
            storedDestCityId: 102,
        });
        expect(definition.parseArgs({ optionText: '알수없음', destCityId: 101 })).toBeNull();
        expect(definition.parseArgs({ optionText: '순간이동', destCityId: 101 })).toEqual({
            optionText: '순간이동',
            destCityId: 101,
        });
    });
});
