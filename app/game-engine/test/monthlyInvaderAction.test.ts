import { describe, expect, it, vi } from 'vitest';
import type { City, Nation } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import {
    createAutoDeleteInvaderHandler,
    createInvaderEndingHandler,
    createRaiseInvaderHandler,
} from '../src/turn/monthlyInvaderAction.js';
import { createMonthlyEventHandler } from '../src/turn/monthlyEventHandler.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildCity = (id: number, nationId: number, level: number): City => ({
    id,
    name: `도시${id}`,
    nationId,
    level,
    state: 0,
    population: 1_000,
    populationMax: 10_000,
    agriculture: 2_000,
    agricultureMax: 20_000,
    commerce: 3_000,
    commerceMax: 30_000,
    security: 4_000,
    securityMax: 40_000,
    supplyState: 0,
    frontState: 1,
    defence: 5_000,
    defenceMax: 50_000,
    wall: 6_000,
    wallMax: 60_000,
    meta: { trust: 50 },
});

const buildNation = (id: number, capitalCityId = 1, name = `국가${id}`): Nation => ({
    id,
    name,
    color: '#777777',
    capitalCityId,
    chiefGeneralId: 1,
    gold: 1_000,
    rice: 1_000,
    power: 0,
    level: 2,
    typeCode: 'che_유가',
    meta: { tech: 100, war: 1, scout: 1 },
});

const buildGeneral = (overrides: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id: 1,
    userId: null,
    name: '군주',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 1_000,
    dedication: 1_000,
    officerLevel: 12,
    role: {
        personality: 'che_안전',
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 1100,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
    bornYear: 170,
    deadYear: 250,
    affinity: 1,
    picture: 'default.jpg',
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    lastTurn: { command: '휴식' },
    turnTime: new Date('0200-01-01T00:05:00.000Z'),
    recentWarTime: null,
    meta: { killturn: 1_000, dex1: 10, dex2: 20, dex3: 30, dex4: 40, dex5: 50 },
    ...overrides,
});

const event: TurnEvent = {
    id: 7,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['RaiseInvader', 10, 150, 100, 20]],
    meta: {},
};

const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
    iconPath: '.',
    map: {},
    const: {},
    environment: { mapName: 'test', unitSet: 'default' },
};

const buildHarness = (options?: {
    cities?: City[];
    nations?: Nation[];
    generals?: TurnGeneral[];
    events?: TurnEvent[];
    meta?: Record<string, unknown>;
}) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 200,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
        meta: {
            hiddenSeed: 'raise-invader-fixture',
            serverId: 'fixture-server',
            refreshLimit: 3,
            ...options?.meta,
        },
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig,
        map: {
            id: 'test',
            name: 'test',
            cities: [],
        },
        generals: options?.generals ?? [buildGeneral()],
        cities: options?.cities ?? [buildCity(1, 1, 3), buildCity(2, 0, 4)],
        nations: options?.nations ?? [buildNation(1)],
        troops: [],
        diplomacy: [],
        events: options?.events ?? [event],
        initialEvents: [],
    };
    const world = new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
    const prisma = {
        generalTurn: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
        nationTurn: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    };
    const reservedTurns = new InMemoryReservedTurnStore(prisma as never, {
        maxGeneralTurns: 30,
        maxNationTurns: 12,
    });
    return {
        state,
        snapshot,
        world,
        reservedTurns,
        environment: {
            year: 200,
            month: 1,
            startyear: 190,
            currentEventID: 7,
            turnTime: state.lastTurnTime,
        },
    };
};

describe('invader monthly actions', () => {
    it('creates the invader nation, generals, diplomacy, follow-up events, and city state', async () => {
        const harness = buildHarness();
        const handler = createRaiseInvaderHandler({
            getWorld: () => harness.world,
            reservedTurns: harness.reservedTurns,
            env: buildCommandEnv(scenarioConfig),
            loadArchivedNationMaxId: vi.fn().mockResolvedValue(9),
        });

        await handler([10, 150, 100, 20], harness.environment, event);

        const dirty = harness.world.peekDirtyState();
        expect(dirty.createdNations).toHaveLength(1);
        expect(dirty.createdNations[0]).toMatchObject({
            id: 10,
            name: 'ⓞ도시2족',
            color: '#800080',
            capitalCityId: 2,
            chiefGeneralId: 2,
            gold: 9_999_999,
            rice: 9_999_999,
            level: 2,
            typeCode: 'che_병가',
            meta: { tech: 100, gennum: 10 },
        });
        expect(dirty.createdGenerals).toHaveLength(10);
        expect(dirty.createdGenerals[0]).toMatchObject({
            id: 2,
            name: 'ⓞ도시2대왕',
            nationId: 10,
            cityId: 2,
            stats: { leadership: 90, strength: 90, intelligence: 60 },
            experience: 1_200,
            dedication: 2_000,
            officerLevel: 12,
            gold: 99_999,
            rice: 99_999,
            npcState: 9,
            affinity: 999,
        });
        expect(harness.world.getGeneralById(1)).toMatchObject({ gold: 999_999, rice: 999_999 });
        expect(harness.world.getCityById(2)).toMatchObject({
            nationId: 10,
            populationMax: 200_000,
            population: 200_000,
            agriculture: 20_000,
            commerce: 30_000,
            security: 40_000,
            defenceMax: 100_000,
            wallMax: 10_000,
            supplyState: 1,
            frontState: 0,
        });
        expect(harness.world.getCityById(1)).toMatchObject({
            population: 10_000,
            agriculture: 20_000,
            commerce: 30_000,
            security: 40_000,
        });
        expect(dirty.createdEvents.map((created) => created.action)).toEqual([
            [['AutoDeleteInvader', 10]],
            [['InvaderEnding']],
        ]);
        expect(
            harness.world
                .listDiplomacy()
                .filter((entry) => entry.fromNationId !== entry.toNationId)
                .map((entry) => [entry.fromNationId, entry.toNationId, entry.state, entry.term])
        ).toEqual([
            [1, 10, 1, 24],
            [10, 1, 1, 24],
        ]);
        expect(dirty.logs.map((log) => log.text)).toEqual([
            '<L><b>【이벤트】</b></>각지의 이민족들이 <M>궐기</>합니다!',
            '<L><b>【이벤트】</b></>중원의 전 국가에 <M>선전포고</> 합니다!',
            '<L><b>【이벤트】</b></>이민족의 기세는 그 누구도 막을 수 없을듯 합니다!',
        ]);
        expect(harness.world.getState().meta).toMatchObject({
            isunited: 1,
            block_change_scout: false,
            lastNationId: 10,
        });
        expect(harness.reservedTurns.peekDirtyState()).toMatchObject({
            generalInitializationIds: expect.arrayContaining(Array.from({ length: 10 }, (_, index) => index + 2)),
            nationInitializationKeys: ['10:12', '10:11', '10:10', '10:9'],
        });
    });

    it('moves a level-4 capital and scales turn times when the general limit requires a longer term', async () => {
        const cities = [buildCity(1, 1, 4), buildCity(2, 1, 3), buildCity(3, 0, 4)];
        const harness = buildHarness({ cities });
        const handler = createRaiseInvaderHandler({
            getWorld: () => harness.world,
            reservedTurns: harness.reservedTurns,
            env: buildCommandEnv(scenarioConfig),
            maxGeneralsPerMinute: 1,
        });

        await handler([10, 150, 100, 20], harness.environment, event);

        expect(harness.world.getNationById(1)?.capitalCityId).toBe(2);
        expect(harness.world.getGeneralById(1)?.cityId).toBe(2);
        expect(harness.world.getState().tickSeconds).toBe(30 * 60);
        expect(harness.world.getGeneralById(1)?.turnTime.toISOString()).toBe('0200-01-01T00:15:00.000Z');
        expect(harness.world.peekDirtyState().logs[0]?.text).toBe('<R>★</>턴시간이 <C>30분</>으로 변경됩니다.');
    });

    it('keeps an invader event while at war, then overwrites the ruler turns and deletes it at peace', async () => {
        const autoDeleteEvent: TurnEvent = {
            id: 8,
            targetCode: 'month',
            priority: 1_000,
            condition: true,
            action: [['AutoDeleteInvader', 2]],
            meta: {},
        };
        const harness = buildHarness({
            cities: [buildCity(1, 1, 3), buildCity(2, 2, 4)],
            nations: [buildNation(1), buildNation(2, 2, 'ⓞ도시2족')],
            generals: [buildGeneral(), buildGeneral({ id: 2, name: 'ⓞ도시2대왕', nationId: 2, cityId: 2 })],
            events: [autoDeleteEvent],
        });
        harness.world.applyDiplomacyPatch({
            srcNationId: 2,
            destNationId: 1,
            patch: { state: 1, term: 24 },
        });
        const handler = createAutoDeleteInvaderHandler({
            getWorld: () => harness.world,
            reservedTurns: harness.reservedTurns,
        });
        const environment = { ...harness.environment, currentEventID: 8 };

        await handler([2], environment, autoDeleteEvent);
        expect(harness.world.listEvents().map((entry) => entry.id)).toContain(8);

        harness.world.applyDiplomacyPatch({
            srcNationId: 2,
            destNationId: 1,
            patch: { state: 2, term: 0 },
        });
        await handler([2], environment, autoDeleteEvent);

        expect(harness.world.listEvents().map((entry) => entry.id)).not.toContain(8);
        expect(harness.reservedTurns.getGeneralTurns(2)).toEqual(
            Array.from({ length: 30 }, () => ({ action: 'che_방랑', args: {} }))
        );
        expect(harness.reservedTurns.peekDirtyState().generalIds).toEqual([2]);
    });

    it('finishes with the legacy user-win logs and refresh multiplier', async () => {
        const endingEvent: TurnEvent = {
            id: 9,
            targetCode: 'month',
            priority: 1_000,
            condition: true,
            action: [['InvaderEnding']],
            meta: {},
        };
        const harness = buildHarness({
            cities: [buildCity(1, 1, 3)],
            events: [endingEvent],
            meta: { isunited: 1, refreshLimit: 3 },
        });
        const handler = createInvaderEndingHandler({ getWorld: () => harness.world });
        const environment = { ...harness.environment, currentEventID: 9 };

        await handler([], environment, endingEvent);

        expect(harness.world.getState().meta).toMatchObject({ isunited: 3, refreshLimit: 300 });
        expect(harness.world.listEvents()).toHaveLength(0);
        expect(harness.world.peekDirtyState().logs.map((log) => log.text)).toEqual([
            '<L><b>【이벤트】</b></>이민족을 모두 소탕했습니다!',
            '<L><b>【이벤트】</b></>중원은 당분간 태평성대를 누릴 것입니다.',
        ]);
    });

    it('does not execute dynamically-added events in the same monthly dispatch', async () => {
        const harness = buildHarness();
        const actions = new Map([
            [
                'RaiseInvader',
                createRaiseInvaderHandler({
                    getWorld: () => harness.world,
                    reservedTurns: harness.reservedTurns,
                    env: buildCommandEnv(scenarioConfig),
                }),
            ],
            [
                'AutoDeleteInvader',
                createAutoDeleteInvaderHandler({
                    getWorld: () => harness.world,
                    reservedTurns: harness.reservedTurns,
                }),
            ],
            ['InvaderEnding', createInvaderEndingHandler({ getWorld: () => harness.world })],
        ]);
        const calendar = createMonthlyEventHandler({
            getWorld: () => harness.world,
            startYear: 190,
            actions,
        });

        await calendar.onMonthChanged?.({
            previousYear: 199,
            previousMonth: 12,
            currentYear: 200,
            currentMonth: 1,
            turnTime: harness.state.lastTurnTime,
        });

        expect(harness.world.peekDirtyState().createdEvents).toHaveLength(2);
        expect(harness.reservedTurns.peekDirtyState().generalIds).toEqual([]);
        expect(harness.world.getState().meta.isunited).toBe(1);
    });

    it.skipIf(!process.env.REF_HIDDEN_SEED)(
        'matches the fixed-seed legacy ruler and first follower RNG fields',
        async () => {
            const invaderNames = ['남만', '산월', '오환', '강', '왜', '흉노', '저'];
            const cities = [
                buildCity(1, 1, 3),
                ...invaderNames.map((name, index) => ({
                    ...buildCity(69 + index, 0, 4),
                    name,
                })),
            ];
            const harness = buildHarness({
                cities,
                meta: { hiddenSeed: process.env.REF_HIDDEN_SEED },
            });
            const handler = createRaiseInvaderHandler({
                getWorld: () => harness.world,
                reservedTurns: harness.reservedTurns,
                env: buildCommandEnv(scenarioConfig),
                loadArchivedNationMaxId: vi.fn().mockResolvedValue(10),
            });

            await handler([10, 150, 100, 20], harness.environment, event);

            const dirty = harness.world.peekDirtyState();
            expect(dirty.createdNations).toHaveLength(7);
            expect(dirty.createdGenerals).toHaveLength(70);
            expect(
                dirty.createdGenerals.slice(0, 3).map((general) => ({
                    name: general.name,
                    nationId: general.nationId,
                    cityId: general.cityId,
                    stats: general.stats,
                    turnTime: general.turnTime.toISOString(),
                    killturn: general.meta.killturn,
                    dex: [
                        general.meta.dex1,
                        general.meta.dex2,
                        general.meta.dex3,
                        general.meta.dex4,
                        general.meta.dex5,
                    ],
                }))
            ).toEqual([
                {
                    name: 'ⓞ남만대왕',
                    nationId: 11,
                    cityId: 69,
                    stats: { leadership: 90, strength: 90, intelligence: 60 },
                    turnTime: '0200-01-01T00:02:40.239Z',
                    killturn: 247,
                    dex: [0, 0, 0, 0, 0],
                },
                {
                    name: 'ⓞ남만장수1',
                    nationId: 11,
                    cityId: 69,
                    stats: { leadership: 70, strength: 13, intelligence: 67 },
                    turnTime: '0200-01-01T00:03:19.647Z',
                    killturn: 242,
                    dex: [20, 20, 20, 40, 0],
                },
                {
                    name: 'ⓞ남만장수2',
                    nationId: 11,
                    cityId: 69,
                    stats: { leadership: 62, strength: 70, intelligence: 18 },
                    turnTime: '0200-01-01T00:02:09.634Z',
                    killturn: 250,
                    dex: expect.arrayContaining([40, 20, 20, 20, 0]),
                },
            ]);
        }
    );
});
