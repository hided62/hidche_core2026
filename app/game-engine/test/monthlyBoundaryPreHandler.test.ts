import { describe, expect, it } from 'vitest';
import type { City, Nation, TurnCommandEnv } from '@sammo-ts/logic';

import { composeCalendarHandlers } from '../src/turn/calendarHandlers.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createMonthlyBoundaryPreHandler } from '../src/turn/monthlyBoundaryPreHandler.js';
import { createNationTurnMonthlyHandler } from '../src/turn/nationTurnMonthlyHandler.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildGeneral = (id: number, makeLimit: number, refreshScoreTotal: number): TurnGeneral => ({
    id,
    name: `장수${id}`,
    nationId: 0,
    cityId: id,
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
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 20,
    npcState: 2,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 0, makelimit: makeLimit },
    refreshScoreTotal,
    turnTime: new Date('0200-12-01T00:00:00.000Z'),
});

const buildCity = (id: number, state: number, term: number): City => ({
    id,
    name: `도시${id}`,
    nationId: id <= 2 ? 1 : 0,
    level: 1,
    state,
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
    conflict: { 1: id * 10 },
    meta: { term },
});

const nation: Nation = {
    id: 1,
    name: 'fixture-nation-1',
    color: '#777777',
    capitalCityId: 1,
    chiefGeneralId: null,
    gold: 0,
    rice: 0,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: {
        rate: 35,
        rate_tmp: 10,
        strategic_cmd_limit: 2,
        surlimit: 1,
        spy: { 1: 1, 2: 2 },
    },
};

const commandEnv = { develCost: 18 } as TurnCommandEnv;

describe('monthly pre-update boundary', () => {
    it('matches the fixed legacy preUpdateMonthly state transition before MONTH actions', async () => {
        const state: TurnWorldState = {
            id: 1,
            currentYear: 200,
            currentMonth: 12,
            tickSeconds: 600,
            lastTurnTime: new Date('0200-12-01T00:00:00.000Z'),
            meta: { develcost: 18 },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: { id: 'test', name: 'test', cities: [] },
            diplomacy: [],
            events: [],
            initialEvents: [],
            generals: [buildGeneral(1, 2, 101), buildGeneral(2, 0, 1)],
            cities: [
                buildCity(1, 31, 1),
                buildCity(2, 32, 2),
                buildCity(3, 33, 0),
                buildCity(4, 34, 3),
                buildCity(5, 41, 1),
                buildCity(6, 42, 2),
                buildCity(7, 43, 3),
            ],
            nations: [nation],
            troops: [],
        };
        let world: InMemoryTurnWorld | null = null;
        const trace: unknown[] = [];
        const boundaryHandler = createMonthlyBoundaryPreHandler({
            getWorld: () => world,
            startYear: 190,
            commandEnv,
        });
        const nationHandler = createNationTurnMonthlyHandler({ getWorld: () => world });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: composeCalendarHandlers(boundaryHandler, nationHandler, {
                onMonthChanged: () => {
                    trace.push({
                        state: world?.listCities().map((city) => city.state),
                        rate: world?.getNationById(1)?.meta.rate_tmp,
                        develCost: commandEnv.develCost,
                    });
                },
            }),
        });

        await world.advanceMonth(new Date('0201-01-01T00:00:00.000Z'));

        expect(world.listGenerals().map((general) => [general.meta.makelimit, general.refreshScoreTotal])).toEqual([
            [1, 99],
            [0, 0],
        ]);
        expect(world.getNationById(1)?.meta).toEqual(
            expect.objectContaining({
                rate: 35,
                rate_tmp: 35,
                strategic_cmd_limit: 1,
                surlimit: 0,
                spy: { 2: 1 },
            })
        );
        expect(world.listCities().map((city) => city.state)).toEqual([0, 31, 0, 33, 0, 41, 42]);
        expect(world.listCities().map((city) => city.meta.term)).toEqual([0, 1, 0, 2, 0, 1, 2]);
        expect(world.listCities().map((city) => city.conflict)).toEqual([
            {},
            { 1: 20 },
            {},
            { 1: 40 },
            {},
            { 1: 60 },
            { 1: 70 },
        ]);
        expect(world.getState().meta.develcost).toBe(40);
        expect(commandEnv.develCost).toBe(40);
        expect(trace).toEqual([{ state: [0, 31, 0, 33, 0, 41, 42], rate: 35, develCost: 40 }]);
    });
});
