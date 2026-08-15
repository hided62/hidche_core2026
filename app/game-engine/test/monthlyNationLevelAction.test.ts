import { describe, expect, it, vi } from 'vitest';
import {
    ITEM_KEYS,
    LogCategory,
    LogScope,
    loadItemModules,
    type City,
    type ItemModule,
    type Nation,
} from '@sammo-ts/logic';
import { createItemInventoryFromSlots } from '@sammo-ts/logic/items/inventory.js';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createUpdateNationLevelHandler } from '../src/turn/monthlyNationLevelAction.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const uniqueHorse: ItemModule = {
    key: 'test_unique_horse',
    name: '시험명마',
    rawName: '시험명마',
    info: '',
    slot: 'horse',
    cost: null,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: true,
};

const buildCity = (id: number, nationId = 1, level = 4): City => ({
    id,
    name: `도시${id}`,
    nationId,
    level,
    state: 0,
    population: 1_000,
    populationMax: 2_000,
    agriculture: 500,
    agricultureMax: 1_000,
    commerce: 500,
    commerceMax: 1_000,
    security: 500,
    securityMax: 1_000,
    supplyState: 1,
    frontState: 0,
    defence: 500,
    defenceMax: 1_000,
    wall: 500,
    wallMax: 1_000,
    meta: {},
});

const buildNation = (level: number, patch: Partial<Nation> = {}): Nation => ({
    id: 1,
    name: '위',
    color: '#000000',
    capitalCityId: 1,
    chiefGeneralId: 1,
    gold: 10_000,
    rice: 20_000,
    power: 0,
    level,
    typeCode: 'che_중립',
    meta: { marker: 1 },
    ...patch,
});

const buildGeneral = (id: number, patch: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id,
    userId: `user-${id}`,
    name: id === 1 ? '조조' : `장수${id}`,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 90, strength: 70, intelligence: 90 },
    experience: 0,
    dedication: 0,
    officerLevel: id === 1 ? 12 : 5,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 100,
    crewTypeId: 1100,
    train: 100,
    atmos: 100,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 1_000, belong: 5 },
    turnTime: new Date('0193-01-01T00:00:00.000Z'),
    ...patch,
});

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['UpdateNationLevel']],
    meta: {},
};

const buildHarness = async (
    nationLevel: number,
    cityCount: number,
    options: {
        hiddenSeed?: string;
        itemModules?: ItemModule[];
        configConst?: Record<string, unknown>;
        additionalOccupiedCounts?: Map<string, number>;
        neutralCityCount?: number;
    } = {}
) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 193,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0193-01-01T00:00:00.000Z'),
        meta: { hiddenSeed: options.hiddenSeed ?? 'nation-level-test', killturn: 1_000 },
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const:
                options.configConst ??
                ({
                    allItems: { horse: { [uniqueHorse.key]: 1 } },
                    maxUniqueItemLimit: [[-1, 1]],
                } satisfies Record<string, unknown>),
            environment: { mapName: 'test', unitSet: 'default' },
        },
        map: {
            id: 'test',
            name: 'test',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        },
        generals: [buildGeneral(1), buildGeneral(2, { meta: { killturn: 850, belong: 30 } })],
        cities: [
            ...Array.from({ length: cityCount }, (_, index) => buildCity(index + 1)),
            ...Array.from({ length: options.neutralCityCount ?? 0 }, (_, index) => buildCity(cityCount + index + 1, 0)),
        ],
        nations: [
            ...(options.neutralCityCount
                ? [
                      buildNation(0, {
                          id: 0,
                          name: '재야',
                          capitalCityId: null,
                          chiefGeneralId: null,
                          gold: 0,
                          rice: 0,
                      }),
                  ]
                : []),
            buildNation(nationLevel),
        ],
        troops: [],
        diplomacy: [],
        events: [event],
        initialEvents: [],
    };
    const world = new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
    const prisma = {
        generalTurn: {
            findMany: vi.fn(async () => []),
            deleteMany: vi.fn(async () => ({ count: 0 })),
            createMany: vi.fn(async () => ({ count: 0 })),
        },
        nationTurn: {
            findMany: vi.fn(async () => []),
            deleteMany: vi.fn(async () => ({ count: 0 })),
            createMany: vi.fn(async () => ({ count: 0 })),
        },
    };
    const reservedTurns = new InMemoryReservedTurnStore(prisma, { maxGeneralTurns: 30, maxNationTurns: 12 });
    await reservedTurns.loadAll();
    const handler = createUpdateNationLevelHandler({
        getWorld: () => world,
        reservedTurns,
        itemModules: options.itemModules ?? [uniqueHorse],
        loadAdditionalOccupiedUniqueCounts: options.additionalOccupiedCounts
            ? async () => options.additionalOccupiedCounts!
            : undefined,
    });
    return { world, reservedTurns, handler };
};

describe('UpdateNationLevel monthly action', () => {
    it('raises only upward, initializes new chief turns, rewards a unique item, and credits the chief', async () => {
        const { world, reservedTurns, handler } = await buildHarness(0, 2);

        await handler([], { year: 193, month: 2, startyear: 190, currentEventID: 1, turnTime: new Date() }, event);

        expect(world.getNationById(1)).toMatchObject({
            level: 2,
            gold: 12_000,
            rice: 22_000,
            meta: { marker: 1 },
        });
        expect(reservedTurns.peekDirtyState().nationInitializationKeys).toEqual(['1:9', '1:10', '1:11']);
        expect(world.getGeneralById(1)?.role.items.horse).toBe(uniqueHorse.key);
        expect(world.getGeneralById(2)?.role.items.horse).toBeNull();
        expect(world.peekDirtyState().inheritancePointAdjustments).toEqual([
            { userId: 'user-1', key: 'unifier', amount: 500 },
        ]);
        expect(world.peekDirtyState().logs).toEqual(
            expect.arrayContaining([
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    text: '<Y><b>【작위】</b></><Y>조조</>가 독립하여 <D><b>위</b></>라는 <C>군벌</>로 나섰습니다.',
                    format: 2,
                    year: 193,
                    month: 2,
                },
                {
                    scope: LogScope.NATION,
                    category: LogCategory.HISTORY,
                    nationId: 1,
                    text: '<Y>조조</>가 독립하여 <D><b>위</b></>라는 <C>군벌</>로 나서다',
                    format: 2,
                    year: 193,
                    month: 2,
                },
                expect.objectContaining({ scope: LogScope.GENERAL, category: LogCategory.ACTION, generalId: 1 }),
                expect.objectContaining({
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    text: expect.stringContaining('작위보상'),
                }),
            ])
        );
    });

    it('rewards a unique item when the persisted inventory snapshot is frozen', async () => {
        const { world, handler } = await buildHarness(0, 2);
        world.updateGeneral(1, {
            itemInventory: createItemInventoryFromSlots({ horse: null, weapon: null, book: null, item: null }),
        });

        await expect(
            handler([], { year: 193, month: 2, startyear: 190, currentEventID: 1, turnTime: new Date() }, event)
        ).resolves.toBeUndefined();

        expect(world.getGeneralById(1)?.role.items.horse).toBe(uniqueHorse.key);
    });

    it('does not downgrade or pay rewards when the qualifying city count is below the current level', async () => {
        const { world, reservedTurns, handler } = await buildHarness(3, 1);

        await handler([], { year: 193, month: 2, startyear: 190, currentEventID: 1, turnTime: new Date() }, event);

        expect(world.getNationById(1)).toMatchObject({ level: 3, gold: 10_000, rice: 20_000 });
        expect(reservedTurns.peekDirtyState().nationInitializationKeys).toEqual([]);
        expect(world.peekDirtyState().inheritancePointAdjustments).toEqual([]);
        expect(world.peekDirtyState().logs).toEqual([]);
    });

    it('never promotes the Core-only neutral nation sentinel from neutral cities', async () => {
        const { world, handler } = await buildHarness(0, 0, { neutralCityCount: 21 });

        await handler([], { year: 193, month: 2, startyear: 190, currentEventID: 1, turnTime: new Date() }, event);

        expect(world.getNationById(0)).toMatchObject({ level: 0, gold: 0, rice: 0 });
        expect(world.peekDirtyState().logs).toEqual([]);
    });

    it('sets both rename permissions only on promotion to emperor', async () => {
        const { world, handler } = await buildHarness(6, 21);

        await handler([], { year: 203, month: 1, startyear: 190, currentEventID: 1, turnTime: new Date() }, event);

        expect(world.getNationById(1)).toMatchObject({
            level: 7,
            gold: 17_000,
            rice: 27_000,
            meta: { marker: 1, can_국기변경: 1, can_국호변경: 1 },
        });
        expect(world.peekDirtyState().inheritancePointAdjustments).toEqual([
            { userId: 'user-1', key: 'unifier', amount: 250 },
        ]);
    });

    it('does not duplicate a unique item reserved by an unfinished auction', async () => {
        const { world, handler } = await buildHarness(0, 1, {
            additionalOccupiedCounts: new Map([[uniqueHorse.key, 1]]),
        });

        await handler([], { year: 193, month: 2, startyear: 190, currentEventID: 1, turnTime: new Date() }, event);

        expect(world.getGeneralById(1)?.role.items.horse).toBeNull();
        expect(world.peekDirtyState().logs.some((entry) => entry.text.includes('작위보상'))).toBe(false);
        expect(world.peekDirtyState().inheritancePointAdjustments).toEqual([
            { userId: 'user-1', key: 'unifier', amount: 250 },
        ]);
    });
});

describe.skipIf(!process.env.LEGACY_HIDDEN_SEED)('UpdateNationLevel legacy fixed-seed comparison', () => {
    it('selects the same unique item as the isolated legacy fixture', async () => {
        const itemModules = await loadItemModules([...ITEM_KEYS]);
        const { world, handler } = await buildHarness(0, 2, {
            hiddenSeed: process.env.LEGACY_HIDDEN_SEED!,
            itemModules,
            configConst: { maxUniqueItemLimit: [[-1, 1]] },
        });

        await handler([], { year: 193, month: 2, startyear: 190, currentEventID: 1, turnTime: new Date() }, event);

        expect(world.getGeneralById(1)?.role.items).toEqual({
            horse: null,
            weapon: null,
            book: 'che_서적_13_관자',
            item: null,
        });
    });
});
