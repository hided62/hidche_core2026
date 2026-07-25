import { describe, expect, it } from 'vitest';
import type { City, Nation } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import {
    createFinishNationBettingHandler,
    createOpenNationBettingHandler,
} from '../src/turn/monthlyNationBettingAction.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildNation = (id: number, power: number): Nation => ({
    id,
    name: `국가${id}`,
    color: `#00000${id}`,
    capitalCityId: id,
    chiefGeneralId: id,
    gold: id * 100,
    rice: id * 200,
    power,
    level: 2,
    typeCode: 'che_유가',
    meta: { tech: id * 10 },
});

const buildCity = (id: number): City => ({
    id,
    name: `도시${id}`,
    nationId: id,
    level: 3,
    state: 0,
    population: 1_000,
    populationMax: 2_000,
    agriculture: 1_000,
    agricultureMax: 2_000,
    commerce: 1_000,
    commerceMax: 2_000,
    security: 1_000,
    securityMax: 2_000,
    supplyState: 1,
    frontState: 0,
    defence: 1_000,
    defenceMax: 2_000,
    wall: 1_000,
    wallMax: 2_000,
    meta: {},
});

const buildGeneral = (id: number): TurnGeneral => ({
    id,
    userId: `user-${id}`,
    name: `장수${id}`,
    nationId: id,
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
    gold: 0,
    rice: 0,
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
    turnTime: new Date('0200-01-01T00:00:00.000Z'),
    meta: { killturn: 1_000 },
});

const sourceEvent: TurnEvent = {
    id: 7,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['OpenNationBetting', 1, 500]],
    meta: {},
};

const buildWorld = () => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 200,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
        meta: { lastBettingId: 4 },
    };
    const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
        stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
        iconPath: '.',
        map: {},
        const: {},
        environment: { mapName: 'test', unitSet: 'default' },
    };
    return new InMemoryTurnWorld(
        state,
        {
            scenarioConfig,
            map: { id: 'test', name: 'test', cities: [] },
            generals: [buildGeneral(1), buildGeneral(2)],
            cities: [buildCity(1), buildCity(2)],
            nations: [buildNation(1, 100), buildNation(2, 300)],
            troops: [],
            diplomacy: [],
            events: [sourceEvent],
            initialEvents: [],
        },
        { schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] } }
    );
};

describe('nation betting monthly actions', () => {
    it('opens a nation bet, adds its finish event, history and private notices', async () => {
        const world = buildWorld();
        const environment = {
            year: 200,
            month: 1,
            startyear: 190,
            currentEventID: 7,
            turnTime: new Date('0200-01-01T00:00:00.000Z'),
        };
        await createOpenNationBettingHandler({ getWorld: () => world })([1, 500], environment, sourceEvent);

        const dirty = world.peekDirtyState();
        expect(world.getState().meta.lastBettingId).toBe(5);
        expect(dirty.pendingNationBettingOpens).toHaveLength(1);
        expect(dirty.pendingNationBettingOpens[0]).toMatchObject({
            id: 5,
            name: '천통국 예상',
            selectCount: 1,
            openYearMonth: 2_400,
            closeYearMonth: 2_424,
            bonusPoint: 500,
        });
        expect(dirty.pendingNationBettingOpens[0]?.candidates.map((candidate) => candidate.aux.nation)).toEqual([
            2, 1,
        ]);
        expect(dirty.createdEvents).toEqual([
            expect.objectContaining({
                targetCode: 'DESTROY_NATION',
                priority: 1_000,
                condition: ['RemainNation', '<=', 1],
                action: [
                    ['FinishNationBetting', 5],
                    ['DeleteEvent'],
                ],
            }),
        ]);
        expect(dirty.logs).toHaveLength(1);
        expect(dirty.messages).toHaveLength(2);
        expect(dirty.messages[0]?.text).toBe(
            '새로운 천통국 내기가 열렸습니다. 천통국 베팅란을 확인해주세요.'
        );

        await createFinishNationBettingHandler({ getWorld: () => world })([5], environment, sourceEvent);
        expect(world.peekDirtyState().pendingNationBettingFinishes).toEqual([
            {
                id: 5,
                winnerNationIds: [1, 2],
                year: 200,
                month: 1,
                turnTime: new Date('0200-01-01T00:00:00.000Z'),
            },
        ]);
    });
});
