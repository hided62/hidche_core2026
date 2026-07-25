import { describe, expect, it } from 'vitest';
import type { City, MapDefinition } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import {
    createMonthlyEventHandler,
    createRandomizeCityTradeRateHandler,
    type MonthlyEventActionHandler,
} from '../src/turn/monthlyEventHandler.js';
import type { TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const map: MapDefinition = {
    id: 'event-test',
    name: 'event-test',
    cities: [],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const buildWorld = (
    events: TurnWorldSnapshot['events'],
    actions: Map<string, MonthlyEventActionHandler>,
    cities: City[] = []
): InMemoryTurnWorld => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 189,
        currentMonth: 12,
        tickSeconds: 600,
        lastTurnTime: new Date('0189-12-01T00:00:00.000Z'),
        meta: { hiddenSeed: 'monthly-event-test-seed' },
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: map.id, unitSet: 'default' },
        },
        scenarioMeta: {
            title: 'event test',
            startYear: 189,
            life: null,
            fiction: null,
            history: [],
            ignoreDefaultEvents: false,
        },
        map,
        diplomacy: [],
        events,
        initialEvents: [],
        generals: [],
        cities,
        nations: [],
        troops: [],
    };
    let world: InMemoryTurnWorld | null = null;
    const handler = createMonthlyEventHandler({
        getWorld: () => world,
        startYear: 189,
        actions,
    });
    world = new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        calendarHandler: handler,
    });
    return world;
};

const buildCity = (id: number, level: number): City => ({
    id,
    name: `도시${id}`,
    nationId: 0,
    level,
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
    meta: { trust: 50, trade: 100, marker: id },
});

describe('monthly event pipeline', () => {
    it('runs PRE_MONTH before the date change and MONTH after it in priority/id order', async () => {
        const trace: string[] = [];
        const actions = new Map<string, MonthlyEventActionHandler>([
            [
                'Trace',
                (args, environment) => {
                    trace.push(`${String(args[0])}:${environment.year}-${environment.month}`);
                },
            ],
        ]);
        const world = buildWorld(
            [
                {
                    id: 2,
                    targetCode: 'month',
                    priority: 10,
                    condition: true,
                    action: [['Trace', 'month-low']],
                    meta: {},
                },
                {
                    id: 3,
                    targetCode: 'month',
                    priority: 20,
                    condition: ['DateRelative', '==', 1, 1],
                    action: [['Trace', 'month-high']],
                    meta: {},
                },
                {
                    id: 1,
                    targetCode: 'pre_month',
                    priority: 0,
                    condition: ['Date', '==', 189, 12],
                    action: [['Trace', 'pre']],
                    meta: {},
                },
            ],
            actions
        );

        await world.advanceMonth(new Date('0190-01-01T00:00:00.000Z'));

        expect(trace).toEqual(['pre:189-12', 'month-high:190-1', 'month-low:190-1']);
    });

    it('supports logic conditions and persists DeleteEvent through dirty state', async () => {
        const world = buildWorld(
            [
                {
                    id: 7,
                    targetCode: 'month',
                    priority: 0,
                    condition: ['and', ['Date', '==', null, 1], ['RemainNation', '==', 0]],
                    action: [['DeleteEvent']],
                    meta: {},
                },
            ],
            new Map()
        );

        await world.advanceMonth(new Date('0190-01-01T00:00:00.000Z'));

        expect(world.listEvents('month')).toEqual([]);
        expect(world.peekDirtyState().deletedEvents).toEqual([7]);
        world.acknowledgeDirtyState(world.peekDirtyState());
        expect(world.peekDirtyState().deletedEvents).toEqual([]);
    });

    it('fails explicitly when a scenario action has not been migrated', async () => {
        const world = buildWorld(
            [
                {
                    id: 9,
                    targetCode: 'month',
                    priority: 0,
                    condition: true,
                    action: [['RaiseInvader']],
                    meta: {},
                },
            ],
            new Map()
        );

        await expect(world.advanceMonth(new Date('0190-01-01T00:00:00.000Z'))).rejects.toThrow(
            'Unsupported monthly event action: RaiseInvader (eventId=9)'
        );
    });

    it('randomizes city trade rates with the legacy seed domain and nullable no-trader state', async () => {
        const actions = new Map<string, MonthlyEventActionHandler>();
        const world = buildWorld(
            [
                {
                    id: 10,
                    targetCode: 'month',
                    priority: 0,
                    condition: true,
                    action: [['RandomizeCityTradeRate']],
                    meta: {},
                },
            ],
            actions,
            [buildCity(1, 1), buildCity(2, 4), buildCity(3, 5), buildCity(4, 6), buildCity(5, 7), buildCity(6, 8)]
        );
        actions.set(
            'RandomizeCityTradeRate',
            createRandomizeCityTradeRateHandler({
                getWorld: () => world,
            })
        );

        await world.advanceMonth(new Date('0190-01-01T00:00:00.000Z'));

        expect(
            world.listCities().map((city) => ({
                id: city.id,
                trade: city.meta.trade ?? null,
                marker: city.meta.marker,
            }))
        ).toEqual([
            { id: 1, trade: null, marker: 1 },
            { id: 2, trade: null, marker: 2 },
            { id: 3, trade: 101, marker: 3 },
            { id: 4, trade: 100, marker: 4 },
            { id: 5, trade: 105, marker: 5 },
            { id: 6, trade: 102, marker: 6 },
        ]);
        expect(world.peekDirtyState().cities.map((city) => city.id)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('rejects an unsupported city level instead of changing RNG consumption silently', async () => {
        const actions = new Map<string, MonthlyEventActionHandler>();
        const world = buildWorld(
            [
                {
                    id: 11,
                    targetCode: 'month',
                    priority: 0,
                    condition: true,
                    action: [['RandomizeCityTradeRate']],
                    meta: {},
                },
            ],
            actions,
            [buildCity(99, 9)]
        );
        actions.set('RandomizeCityTradeRate', createRandomizeCityTradeRateHandler({ getWorld: () => world }));

        await expect(world.advanceMonth(new Date('0190-01-01T00:00:00.000Z'))).rejects.toThrow(
            'Unsupported city level for RandomizeCityTradeRate: 9 (cityId=99)'
        );
    });
});
