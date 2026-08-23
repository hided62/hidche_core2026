import { describe, expect, it } from 'vitest';
import type { City, Nation } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createDynastyStatisticsHandler, queueYearbookSnapshot } from '../src/turn/yearbookHandler.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const turnTime = new Date('0200-01-01T00:00:00.000Z');

const buildGeneral = (id: number, nationId: number): TurnGeneral => ({
    id,
    name: `장수${id}`,
    nationId,
    cityId: nationId,
    troopId: 0,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    experience: 1_000,
    dedication: 900,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 2_000,
    rice: 2_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: nationId === 0 ? 2 : 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    turnTime,
});

const buildCity = (id: number, nationId: number): City => ({
    id,
    name: `도시${id}`,
    nationId,
    level: 1,
    state: 0,
    population: 10_000,
    populationMax: 20_000,
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

const buildNation = (id: number, power: number, meta: Nation['meta']): Nation => ({
    id,
    name: id === 0 ? '재야' : `국가${id}`,
    color: '#777777',
    capitalCityId: id === 0 ? null : id,
    chiefGeneralId: null,
    gold: 10_000,
    rice: 20_000,
    power,
    level: id === 0 ? 0 : 1,
    typeCode: 'che_중립',
    meta,
});

type YearbookNationProjection = {
    id: number;
    name: string;
    color: string;
    level: number;
    power: number;
    generalCount: number;
};

describe('yearbook nation projection', () => {
    it('archives stored nation power/count, preserves zero, and fixes the synthetic neutral values', async () => {
        const state: TurnWorldState = {
            id: 1,
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: turnTime,
            meta: { serverId: 'yearbook-projection-test' },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'test' },
            },
            scenarioMeta: {
                title: '연감 테스트',
                startYear: 200,
                life: null,
                fiction: 0,
                history: [],
                ignoreDefaultEvents: false,
            },
            map: { id: 'test', name: 'test', cities: [] },
            nations: [
                {
                    ...buildNation(0, 90, { gennum: 90, tech: 90 }),
                    name: '오염된 재야',
                    color: '#ffffff',
                    level: 9,
                },
                buildNation(1, 777, { gennum: 9, tech: 100 }),
                buildNation(2, 0, { tech: 100 }),
            ],
            cities: [buildCity(0, 0), buildCity(1, 1), buildCity(2, 2)],
            generals: [
                buildGeneral(1, 0),
                buildGeneral(2, 0),
                buildGeneral(3, 1),
                buildGeneral(4, 2),
                buildGeneral(5, 2),
            ],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });

        queueYearbookSnapshot(world, 'che', 200, 1);

        const pending = world.peekDirtyState().pendingYearbookSnapshots[0];
        if (!pending) {
            throw new Error('expected a queued yearbook snapshot');
        }
        const nations = pending.nations as YearbookNationProjection[];
        expect(nations.map((nation) => nation.id)).toEqual([1, 0, 2]);
        expect(nations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 0,
                    name: '재야',
                    color: '#000000',
                    level: 0,
                    power: 1,
                    generalCount: 1,
                }),
                expect.objectContaining({ id: 1, power: 777, generalCount: 9 }),
                expect.objectContaining({ id: 2, power: 0, generalCount: 2 }),
            ])
        );

        // The contamination above exists only to exercise the archive
        // projection. Runtime nation zero is normally level zero.
        world.updateNation(0, { level: 0 });

        const dynastyHandler = createDynastyStatisticsHandler({ getWorld: () => world }).handler;
        await dynastyHandler.onMonthChanged?.({
            previousYear: 200,
            previousMonth: 1,
            currentYear: 200,
            currentMonth: 2,
            turnTime,
        });
        expect(world.getState().meta.dynastyStatistics).toBeUndefined();

        await dynastyHandler.onMonthChanged?.({
            previousYear: 200,
            previousMonth: 12,
            currentYear: 201,
            currentMonth: 1,
            turnTime,
        });
        expect(world.getState().meta.dynastyStatistics).toMatchObject({
            maxNationCount: 2,
            maxGeneralCount: 5,
            currentGeneralCount: 5,
            userGeneralCount: 3,
            npcGeneralCount: 2,
        });
    });
});
