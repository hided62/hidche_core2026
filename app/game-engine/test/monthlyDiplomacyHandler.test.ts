import { describe, expect, it } from 'vitest';
import { DIPLOMACY_STATE, LogCategory, LogFormat, LogScope, type Nation } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createMonthlyDiplomacyHandler } from '../src/turn/monthlyNationStatsHandler.js';
import type { TurnDiplomacy, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildNation = (id: number, name: string, generalCount: number): Nation => ({
    id,
    name,
    color: '#777777',
    capitalCityId: null,
    chiefGeneralId: null,
    gold: 0,
    rice: 0,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: { gennum: generalCount },
});

const diplomacy: TurnDiplomacy[] = [
    { fromNationId: 1, toNationId: 2, state: 1, term: 1, dead: 777, meta: {} },
    { fromNationId: 2, toNationId: 1, state: 1, term: 1, dead: 888, meta: {} },
    { fromNationId: 1, toNationId: 3, state: 0, term: 5, dead: 250, meta: {} },
    { fromNationId: 3, toNationId: 1, state: 0, term: 5, dead: 50, meta: {} },
    { fromNationId: 3, toNationId: 4, state: 0, term: 1, dead: 0, meta: {} },
    { fromNationId: 4, toNationId: 3, state: 0, term: 1, dead: 0, meta: {} },
    { fromNationId: 2, toNationId: 4, state: 7, term: 1, dead: 999, meta: {} },
    { fromNationId: 5, toNationId: 6, state: 0, term: 1, dead: 0, meta: {} },
    { fromNationId: 6, toNationId: 5, state: 0, term: 3, dead: 0, meta: {} },
];

describe('monthly diplomacy post-update', () => {
    it('shares war terms across both directions and emits each transition log once', async () => {
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
            map: { id: 'test', name: 'test', cities: [] },
            diplomacy,
            events: [],
            initialEvents: [],
            generals: [],
            cities: [],
            nations: [
                buildNation(1, '갑국', 2),
                buildNation(2, '을국', 1),
                buildNation(3, '병국', 1),
                buildNation(4, '정국', 1),
                buildNation(5, '무국', 1),
                buildNation(6, '기국', 1),
            ],
            troops: [],
        };
        let world: InMemoryTurnWorld | null = null;
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            autoAdvanceDiplomacyMonth: false,
            calendarHandler: createMonthlyDiplomacyHandler({ getWorld: () => world }),
        });

        await world.advanceMonth(new Date('0193-02-01T00:00:00.000Z'));

        const observedKeys = new Set(diplomacy.map((entry) => `${entry.fromNationId}:${entry.toNationId}`));
        expect(
            world.listDiplomacy().filter((entry) => observedKeys.has(`${entry.fromNationId}:${entry.toNationId}`))
        ).toEqual([
            { fromNationId: 1, toNationId: 2, state: 0, term: 6, dead: 0, meta: {} },
            { fromNationId: 2, toNationId: 1, state: 0, term: 6, dead: 0, meta: {} },
            { fromNationId: 1, toNationId: 3, state: 0, term: 5, dead: 50, meta: {} },
            { fromNationId: 3, toNationId: 1, state: 0, term: 5, dead: 50, meta: {} },
            { fromNationId: 3, toNationId: 4, state: 2, term: 0, dead: 0, meta: {} },
            { fromNationId: 4, toNationId: 3, state: 2, term: 0, dead: 0, meta: {} },
            { fromNationId: 2, toNationId: 4, state: 2, term: 0, dead: 0, meta: {} },
            { fromNationId: 5, toNationId: 6, state: 0, term: 2, dead: 0, meta: {} },
            { fromNationId: 6, toNationId: 5, state: 0, term: 2, dead: 0, meta: {} },
        ]);
        expect(world.consumeDirtyState().logs).toEqual([
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: '<R><b>【개전】</b></><D><b>갑국</b></>과 <D><b>을국</b></>이 <R>전쟁</>을 시작합니다.',
                format: LogFormat.YEAR_MONTH,
            },
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: '<R><b>【종전】</b></><D><b>병국</b></>과 <D><b>정국</b></>이 <S>종전</>합니다.',
                format: LogFormat.YEAR_MONTH,
            },
        ]);

        await world.advanceMonth(new Date('0193-03-01T00:00:00.000Z'));
        expect(
            world
                .listDiplomacy()
                .filter(
                    (entry) =>
                        (entry.fromNationId === 5 && entry.toNationId === 6) ||
                        (entry.fromNationId === 6 && entry.toNationId === 5)
                )
                .map(({ state, term }) => ({ state, term }))
        ).toEqual([
            { state: DIPLOMACY_STATE.WAR, term: 1 },
            { state: DIPLOMACY_STATE.WAR, term: 1 },
        ]);
        expect(world.consumeDirtyState().logs).toEqual([]);

        await world.advanceMonth(new Date('0193-04-01T00:00:00.000Z'));
        expect(
            world
                .listDiplomacy()
                .filter(
                    (entry) =>
                        (entry.fromNationId === 5 && entry.toNationId === 6) ||
                        (entry.fromNationId === 6 && entry.toNationId === 5)
                )
                .map(({ state, term }) => ({ state, term }))
        ).toEqual([
            { state: DIPLOMACY_STATE.TRADE, term: 0 },
            { state: DIPLOMACY_STATE.TRADE, term: 0 },
        ]);
        expect(world.consumeDirtyState().logs).toEqual([
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: '<R><b>【종전】</b></><D><b>무국</b></>과 <D><b>기국</b></>이 <S>종전</>합니다.',
                format: LogFormat.YEAR_MONTH,
            },
        ]);
    });
});
