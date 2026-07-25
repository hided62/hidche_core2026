import { describe, expect, it } from 'vitest';
import {
    LogCategory,
    LogFormat,
    LogScope,
    type City,
    type MapDefinition,
    type Nation,
} from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createUpdateCitySupplyHandler } from '../src/turn/monthlyCitySupplyAction.js';
import { createMonthlyEventHandler, type MonthlyEventActionHandler } from '../src/turn/monthlyEventHandler.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const map: MapDefinition = {
    id: 'city-supply-test',
    name: 'city-supply-test',
    cities: [
        {
            id: 1,
            name: '수도',
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [2],
            max: { population: 2_000, agriculture: 1_000, commerce: 1_000, security: 1_000, defence: 1_000, wall: 1_000 },
            initial: { population: 1_000, agriculture: 500, commerce: 500, security: 500, defence: 500, wall: 500 },
        },
        {
            id: 2,
            name: '연결도시',
            level: 1,
            region: 1,
            position: { x: 1, y: 0 },
            connections: [1],
            max: { population: 2_000, agriculture: 1_000, commerce: 1_000, security: 1_000, defence: 1_000, wall: 1_000 },
            initial: { population: 1_000, agriculture: 500, commerce: 500, security: 500, defence: 500, wall: 500 },
        },
        {
            id: 3,
            name: '고립성',
            level: 1,
            region: 2,
            position: { x: 3, y: 0 },
            connections: [],
            max: { population: 2_000, agriculture: 1_000, commerce: 1_000, security: 1_000, defence: 1_000, wall: 1_000 },
            initial: { population: 1_000, agriculture: 500, commerce: 500, security: 500, defence: 500, wall: 500 },
        },
        {
            id: 4,
            name: '공백지',
            level: 1,
            region: 2,
            position: { x: 4, y: 0 },
            connections: [],
            max: { population: 2_000, agriculture: 1_000, commerce: 1_000, security: 1_000, defence: 1_000, wall: 1_000 },
            initial: { population: 1_000, agriculture: 500, commerce: 500, security: 500, defence: 500, wall: 500 },
        },
    ],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const buildCity = (id: number, nationId: number, trust = 40): City => ({
    id,
    name: map.cities.find((city) => city.id === id)?.name ?? `도시${id}`,
    nationId,
    level: 1,
    state: 0,
    population: 1_001,
    populationMax: 2_000,
    agriculture: 501,
    agricultureMax: 1_000,
    commerce: 499,
    commerceMax: 1_000,
    security: 99,
    securityMax: 1_000,
    supplyState: 0,
    frontState: 2,
    defence: 101,
    defenceMax: 1_000,
    wall: 50,
    wallMax: 1_000,
    conflict: { 2: 3 },
    meta: { trust, trade: 100, officer_set: 7, term: 2, marker: id },
});

const buildNation = (id: number, capitalCityId: number | null, level = 1): Nation => ({
    id,
    name: `국가${id}`,
    color: '#000000',
    capitalCityId,
    chiefGeneralId: null,
    gold: 1_000,
    rice: 1_000,
    power: 0,
    level,
    typeCode: 'che_중립',
    meta: {},
});

const buildGeneral = (id: number, patch: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id,
    name: `장수${id}`,
    nationId: 1,
    cityId: 3,
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
    gold: 1_000,
    rice: 1_000,
    crew: 101,
    crewTypeId: 1100,
    train: 51,
    atmos: 99,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24, officerCity: 3, officer_city: 3 },
    turnTime: new Date('0193-01-01T00:00:00.000Z'),
    ...patch,
});

const buildWorld = (options: {
    cities: City[];
    nations: Nation[];
    generals?: TurnGeneral[];
}): InMemoryTurnWorld => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 193,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0193-01-01T00:00:00.000Z'),
        meta: {},
    };
    const actions = new Map<string, MonthlyEventActionHandler>();
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: map.id, unitSet: 'default' },
        },
        map,
        generals: options.generals ?? [],
        cities: options.cities,
        nations: options.nations,
        troops: [],
        diplomacy: [],
        events: [
            {
                id: 1,
                targetCode: 'pre_month',
                priority: 9_000,
                condition: true,
                action: [['UpdateCitySupply']],
                meta: {},
            },
        ],
        initialEvents: [],
    };
    let world: InMemoryTurnWorld | null = null;
    const calendarHandler = createMonthlyEventHandler({
        getWorld: () => world,
        startYear: 190,
        actions,
    });
    world = new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        calendarHandler,
    });
    actions.set('UpdateCitySupply', createUpdateCitySupplyHandler({ getWorld: () => world, map }));
    return world;
};

describe('UpdateCitySupply monthly action', () => {
    it('propagates supply from an owned capital and damages only disconnected owned cities', async () => {
        const matchingGeneral = buildGeneral(1);
        const foreignGeneral = buildGeneral(2, { nationId: 2 });
        const suppliedGeneral = buildGeneral(3, { cityId: 2 });
        const world = buildWorld({
            cities: [buildCity(3, 1), buildCity(1, 1), buildCity(4, 0), buildCity(2, 1)],
            nations: [buildNation(2, 3), buildNation(1, 1)],
            generals: [foreignGeneral, suppliedGeneral, matchingGeneral],
        });

        await world.advanceMonth(new Date('0193-02-01T00:00:00.000Z'));

        expect(world.getCityById(1)?.supplyState).toBe(1);
        expect(world.getCityById(2)?.supplyState).toBe(1);
        expect(world.getCityById(4)?.supplyState).toBe(1);
        expect(world.getCityById(3)).toMatchObject({
            nationId: 1,
            supplyState: 0,
            population: 901,
            agriculture: 451,
            commerce: 449,
            security: 89,
            defence: 91,
            wall: 45,
        });
        expect(world.getCityById(3)?.meta.trust).toBeCloseTo(36);
        expect(world.getGeneralById(1)).toMatchObject({ crew: 96, atmos: 94, train: 48 });
        expect(world.getGeneralById(2)).toMatchObject({ crew: 101, atmos: 99, train: 51 });
        expect(world.getGeneralById(3)).toMatchObject({ crew: 101, atmos: 99, train: 51 });
        expect(world.peekDirtyState().logs).toEqual([]);
    });

    it('neutralizes a city below 30 trust after damage and clears every assigned city officer', async () => {
        const localOfficer = buildGeneral(1);
        const remoteOfficer = buildGeneral(2, { cityId: 1, meta: { killturn: 24, officer_city: 3 } });
        const unrelated = buildGeneral(3, {
            cityId: 3,
            nationId: 2,
            officerLevel: 3,
            meta: { killturn: 24, officerCity: 2, officer_city: 2 },
        });
        const world = buildWorld({
            cities: [buildCity(1, 1), buildCity(2, 1), buildCity(3, 1, 33), buildCity(4, 0)],
            nations: [buildNation(1, 1), buildNation(2, 3)],
            generals: [unrelated, remoteOfficer, localOfficer],
        });

        await world.advanceMonth(new Date('0193-02-01T00:00:00.000Z'));

        expect(world.getCityById(3)).toMatchObject({
            nationId: 0,
            supplyState: 0,
            frontState: 0,
            conflict: {},
            meta: {
                trust: expect.closeTo(29.7),
                trade: 100,
                officer_set: 0,
                term: 0,
                marker: 3,
            },
        });
        expect(world.getGeneralById(1)).toMatchObject({
            officerLevel: 1,
            crew: 96,
            atmos: 94,
            train: 48,
            meta: { officerCity: 0, officer_city: 0 },
        });
        expect(world.getGeneralById(2)).toMatchObject({
            officerLevel: 1,
            crew: 101,
            atmos: 99,
            train: 51,
            meta: { officerCity: 0, officer_city: 0 },
        });
        expect(world.getGeneralById(3)).toMatchObject({
            officerLevel: 3,
            crew: 101,
            atmos: 99,
            train: 51,
            meta: { officerCity: 2, officer_city: 2 },
        });
        expect(world.peekDirtyState().logs).toEqual([
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: '<R><b>【고립】</b></><G><b>고립성</b></>이 보급이 끊겨 <R>미지배</> 도시가 되었습니다.',
                format: LogFormat.YEAR_MONTH,
                year: 193,
                month: 1,
            },
        ]);
    });
});
