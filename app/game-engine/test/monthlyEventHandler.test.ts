import { describe, expect, it } from 'vitest';
import { loadActionModuleBundle, LogCategory, LogFormat, LogScope, type City, type MapDefinition } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createRaiseDisasterHandler } from '../src/turn/monthlyDisasterAction.js';
import {
    createMonthlyEventHandler,
    createRandomizeCityTradeRateHandler,
    type MonthlyEventActionHandler,
} from '../src/turn/monthlyEventHandler.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const map: MapDefinition = {
    id: 'event-test',
    name: 'event-test',
    cities: [],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const buildWorld = (
    events: TurnWorldSnapshot['events'],
    actions: Map<string, MonthlyEventActionHandler>,
    cities: City[] = [],
    options: {
        generals?: TurnGeneral[];
        hiddenSeed?: string;
        startYear?: number;
        currentYear?: number;
        currentMonth?: number;
    } = {}
): InMemoryTurnWorld => {
    const currentYear = options.currentYear ?? 189;
    const currentMonth = options.currentMonth ?? 12;
    const startYear = options.startYear ?? 189;
    const state: TurnWorldState = {
        id: 1,
        currentYear,
        currentMonth,
        tickSeconds: 600,
        lastTurnTime: new Date('0189-12-01T00:00:00.000Z'),
        meta: { hiddenSeed: options.hiddenSeed ?? 'monthly-event-test-seed' },
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
            startYear,
            life: null,
            fiction: null,
            history: [],
            ignoreDefaultEvents: false,
        },
        map,
        diplomacy: [],
        events,
        initialEvents: [],
        generals: options.generals ?? [],
        cities,
        nations: [],
        troops: [],
    };
    let world: InMemoryTurnWorld | null = null;
    const handler = createMonthlyEventHandler({
        getWorld: () => world,
        startYear,
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

const buildGeneral = (id: number, patch: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id,
    name: `장수${id}`,
    nationId: 0,
    cityId: 1,
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
    gold: 1_000,
    rice: 1_000,
    crew: 99,
    crewTypeId: 1100,
    train: 51,
    atmos: 50,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    turnTime: new Date('0193-01-01T00:00:00.000Z'),
    ...patch,
});

describe('monthly event pipeline', () => {
    it('runs PRE_MONTH before the date change and MONTH after it in priority/id order', async () => {
        const trace: string[] = [];
        const actions = new Map<string, MonthlyEventActionHandler>([
            [
                'Trace',
                (args, environment) => {
                    trace.push(
                        `${String(args[0])}:${environment.year}-${environment.month}:${environment.turnTime.toISOString()}`
                    );
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

        expect(trace).toEqual([
            'pre:189-12:0189-12-31T23:50:00.000Z',
            'month-high:190-1:0189-12-31T23:50:00.000Z',
            'month-low:190-1:0189-12-31T23:50:00.000Z',
        ]);
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
            [buildCity(6, 8), buildCity(1, 1), buildCity(2, 4), buildCity(3, 5), buildCity(4, 6), buildCity(5, 7)]
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
            { id: 6, trade: 102, marker: 6 },
            { id: 1, trade: null, marker: 1 },
            { id: 2, trade: null, marker: 2 },
            { id: 3, trade: 101, marker: 3 },
            { id: 4, trade: 100, marker: 4 },
            { id: 5, trade: 105, marker: 5 },
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

    it('resets an old disaster marker before the opening three-year skip', async () => {
        const actions = new Map<string, MonthlyEventActionHandler>();
        const world = buildWorld(
            [
                {
                    id: 12,
                    targetCode: 'month',
                    priority: 0,
                    condition: true,
                    action: [['RaiseDisaster']],
                    meta: {},
                },
            ],
            actions,
            [{ ...buildCity(1, 1), state: 5 }, { ...buildCity(2, 1), state: 31 }],
            { startYear: 190, currentYear: 190, currentMonth: 12 }
        );
        actions.set('RaiseDisaster', createRaiseDisasterHandler({ getWorld: () => world }));

        await world.advanceMonth(new Date('0191-01-01T00:00:00.000Z'));

        expect(world.getCityById(1)?.state).toBe(0);
        expect(world.getCityById(2)?.state).toBe(31);
        expect(world.peekDirtyState().logs).toEqual([]);
    });

    it('matches the legacy January disaster RNG, city damage, injury order, and talisman protection', async () => {
        const actions = new Map<string, MonthlyEventActionHandler>();
        const moduleBundle = await loadActionModuleBundle();
        const protectedGeneral = buildGeneral(1, {
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: 'che_부적_태현청생부' },
            },
        });
        const injuredGeneral = buildGeneral(2);
        const cappedGeneral = buildGeneral(3, { injury: 70 });
        const disasterCity: City = {
            ...buildCity(1, 1),
            name: '재난도시',
            state: 5,
            population: 1_001,
            populationMax: 2_000,
            agriculture: 501,
            agricultureMax: 1_000,
            commerce: 499,
            commerceMax: 1_000,
            security: 0,
            securityMax: 100,
            defence: 99,
            defenceMax: 1_000,
            wall: 101,
            wallMax: 1_000,
            meta: { trust: 99.5, trade: 100, marker: 1 },
        };
        const world = buildWorld(
            [
                {
                    id: 13,
                    targetCode: 'month',
                    priority: 0,
                    condition: true,
                    action: [['RaiseDisaster']],
                    meta: {},
                },
            ],
            actions,
            [disasterCity],
            {
                generals: [cappedGeneral, protectedGeneral, injuredGeneral],
                hiddenSeed: 'disaster-test-6',
                startYear: 190,
                currentYear: 192,
                currentMonth: 12,
            }
        );
        actions.set(
            'RaiseDisaster',
            createRaiseDisasterHandler({
                getWorld: () => world,
                generalActionModules: moduleBundle.general,
            })
        );

        await world.advanceMonth(new Date('0193-01-01T00:00:00.000Z'));

        const damagedCity = world.getCityById(1);
        expect(damagedCity).toMatchObject({
            state: 3,
            population: 801,
            agriculture: 401,
            commerce: 399,
            security: 0,
            defence: 79,
            wall: 81,
            meta: { trade: 100, marker: 1 },
        });
        expect(damagedCity?.meta.trust).toBe(Math.fround(79.6));
        expect(world.getGeneralById(1)).toMatchObject({ injury: 0, crew: 99, atmos: 50, train: 51 });
        expect(world.getGeneralById(2)).toMatchObject({ injury: 7, crew: 97, atmos: 49, train: 50 });
        expect(world.getGeneralById(3)).toMatchObject({ injury: 80, crew: 97, atmos: 49, train: 50 });
        expect(world.peekDirtyState().logs).toEqual([
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: '<M><b>【재난】</b></><G><b>재난도시</b></>에 추위가 풀리지 않아 얼어죽는 백성들이 늘어나고 있습니다.',
                format: LogFormat.YEAR_MONTH,
            },
            {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: 2,
                text: '<M>재난</>으로 인해 <R>부상</>을 당했습니다.',
                format: LogFormat.MONTH,
            },
            {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: 3,
                text: '<M>재난</>으로 인해 <R>부상</>을 당했습니다.',
                format: LogFormat.MONTH,
            },
        ]);
    });

    it('matches the legacy April booming RNG and maximum clamps', async () => {
        const actions = new Map<string, MonthlyEventActionHandler>();
        const boomingCity: City = {
            ...buildCity(1, 8),
            name: '호황도시',
            population: 1_001,
            populationMax: 1_100,
            agriculture: 999,
            agricultureMax: 1_000,
            commerce: 500,
            commerceMax: 1_000,
            security: 1_000,
            securityMax: 1_000,
            defence: 101,
            defenceMax: 1_000,
            wall: 99,
            wallMax: 1_000,
            meta: { trust: 99.5, trade: 100 },
        };
        const world = buildWorld(
            [
                {
                    id: 14,
                    targetCode: 'month',
                    priority: 0,
                    condition: true,
                    action: [['RaiseDisaster']],
                    meta: {},
                },
            ],
            actions,
            [boomingCity],
            {
                hiddenSeed: 'booming-test-59',
                startYear: 190,
                currentYear: 193,
                currentMonth: 3,
            }
        );
        actions.set('RaiseDisaster', createRaiseDisasterHandler({ getWorld: () => world }));

        await world.advanceMonth(new Date('0193-04-01T00:00:00.000Z'));

        expect(world.getCityById(1)).toMatchObject({
            state: 2,
            population: 1_051,
            agriculture: 1_000,
            commerce: 525,
            security: 1_000,
            defence: 106,
            wall: 104,
            meta: { trust: 100, trade: 100 },
        });
        expect(world.peekDirtyState().logs).toEqual([
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: '<C><b>【호황】</b></><G><b>호황도시</b></>에 호황으로 도시가 번창하고 있습니다.',
                format: LogFormat.YEAR_MONTH,
            },
        ]);
    });
});
