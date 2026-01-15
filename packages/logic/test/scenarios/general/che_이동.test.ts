import { describe, expect, it } from 'vitest';
import type { General, Nation } from '../../../src/domain/entities.js';
import { buildScenarioBootstrap } from '../../../src/world/bootstrap.js';
import { InMemoryWorld, TestGameRunner } from '../../testEnv.js';
import type { MapDefinition } from '../../../src/world/types.js';

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
        environment: { mapName: 'linear_map', unitSet: 'test_set' },
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
            connections: [101],
            max: {} as any,
            initial: {} as any,
        },
    ],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

describe('che_이동', () => {
    it('applies movement side effects (gold/atmos/exp/leadership_exp)', async () => {
        const bootstrapResult = buildScenarioBootstrap({
            scenario: MOCK_SCENARIO_BASE,
            map: LINEAR_MAP,
            options: { defaultGeneralGold: 1000 },
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
            atmos: 10,
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

        const moveDef = (await import('../../../src/actions/turn/general/che_이동.js')).commandSpec.createDefinition(
            {} as any
        );

        await runner.runTurn([
            {
                generalId: general.id,
                commandKey: 'che_이동',
                resolver: moveDef,
                args: { destCityId: 102 },
                context: {
                    map: LINEAR_MAP,
                    develCost: 100,
                },
            },
        ]);

        const updated = world.getGeneral(general.id);
        expect(updated?.cityId).toBe(102);
        expect(updated?.gold).toBe(900);
        expect(updated?.atmos).toBe(20);
        expect(updated?.experience).toBe(50);
        expect(updated?.meta.leadership_exp).toBe(1);
    });
});
