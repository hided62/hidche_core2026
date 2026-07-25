import { describe, expect, it } from 'vitest';
import type { City, Nation, NationTraitModule } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createProcessWarIncomeHandler } from '../src/turn/monthlyWarIncomeAction.js';
import type { TurnEvent, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildCity = (id: number, patch: Partial<City> = {}): City => ({
    id,
    name: `도시${id}`,
    nationId: 1,
    level: 1,
    state: 0,
    population: 1_000,
    populationMax: 2_000,
    agriculture: 100,
    agricultureMax: 200,
    commerce: 100,
    commerceMax: 200,
    security: 100,
    securityMax: 200,
    supplyState: 1,
    frontState: 0,
    defence: 100,
    defenceMax: 200,
    wall: 100,
    wallMax: 200,
    conflict: {},
    meta: { trust: 50, dead: 0, marker: id },
    ...patch,
});

const buildNation = (id: number, patch: Partial<Nation> = {}): Nation => ({
    id,
    name: `국가${id}`,
    color: '#777777',
    capitalCityId: null,
    chiefGeneralId: null,
    gold: 1_000,
    rice: 1_000,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: {},
    ...patch,
});

const goldTrait: NationTraitModule = {
    key: 'test-gold',
    name: '금 수입 시험',
    info: '',
    kind: 'nation',
    onCalcNationalIncome: (_context, type, amount) => (type === 'gold' ? amount * 1.1 : amount),
};

const event: TurnEvent = {
    id: 1,
    targetCode: 'pre_month',
    priority: 9_000,
    condition: true,
    action: [['ProcessWarIncome']],
    meta: {},
};

const buildHarness = () => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 193,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0193-01-01T00:00:00.000Z'),
        meta: {},
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'default' },
        },
        map: {
            id: 'test',
            name: 'test',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        },
        generals: [],
        cities: [
            buildCity(1, { meta: { trust: 50, dead: 101, marker: 1 } }),
            buildCity(2, { supplyState: 0, meta: { trust: 50, dead: 999, marker: 2 } }),
            buildCity(3, { nationId: 2, meta: { trust: 50, dead: 1_000, marker: 3 } }),
            buildCity(4, { nationId: 3, meta: { trust: 50, dead: 105, marker: 4 } }),
            buildCity(5, {
                nationId: 0,
                population: 999,
                populationMax: 1_000,
                meta: { trust: 50, dead: 10, marker: 5 },
            }),
        ],
        nations: [
            buildNation(1),
            buildNation(2, { level: 0 }),
            buildNation(3, { typeCode: goldTrait.key }),
        ],
        troops: [],
        diplomacy: [],
        events: [event],
        initialEvents: [],
    };
    const world = new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
    const handler = createProcessWarIncomeHandler({
        getWorld: () => world,
        nationTraits: new Map([[goldTrait.key, goldTrait]]),
    });
    return { world, handler };
};

describe('ProcessWarIncome monthly action', () => {
    it('credits supplied-city casualties before global recovery and preserves level/type rules', async () => {
        const { world, handler } = buildHarness();

        await handler(
            [],
            {
                year: 193,
                month: 1,
                startyear: 190,
                currentEventID: 1,
                turnTime: new Date('0193-01-01T00:00:00.000Z'),
            },
            event
        );

        expect(world.getNationById(1)?.gold).toBe(1_010);
        expect(world.getNationById(2)?.gold).toBe(1_000);
        expect(world.getNationById(3)?.gold).toBe(1_012);
        expect(world.listCities().map((city) => [city.id, city.population, city.meta.dead])).toEqual([
            [1, 1_020, 0],
            [2, 1_200, 0],
            [3, 1_200, 0],
            [4, 1_021, 0],
            [5, 1_001, 0],
        ]);
        expect(world.getCityById(1)?.meta.marker).toBe(1);
        expect(world.peekDirtyState().logs).toEqual([]);
    });
});
