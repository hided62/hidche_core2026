import { describe, expect, it } from 'vitest';
import { LogCategory, LogFormat, LogScope, type City, type Nation } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createMonthlyWanderHandler } from '../src/turn/monthlyWanderHandler.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildGeneral = (options: {
    id: number;
    name: string;
    nationId: number;
    cityId: number;
    officerLevel: number;
    npcState: number;
    gold: number;
    rice: number;
    belong: number;
    turnTime: Date;
}): TurnGeneral => ({
    id: options.id,
    name: options.name,
    nationId: options.nationId,
    cityId: options.cityId,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 0,
    dedication: 0,
    officerLevel: options.officerLevel,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: options.gold,
    rice: options.rice,
    crew: 100,
    crewTypeId: 1100,
    train: 0,
    atmos: 0,
    age: 20,
    npcState: options.npcState,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 0, makelimit: 0, belong: options.belong },
    turnTime: options.turnTime,
});

const buildNation = (id: number, name: string, level: number, generalCount: number): Nation => ({
    id,
    name,
    color: '#777777',
    capitalCityId: null,
    chiefGeneralId: null,
    gold: 0,
    rice: 0,
    power: 0,
    level,
    typeCode: 'che_중립',
    meta: { gennum: generalCount },
});

const buildCity = (id: number, name: string, nationId: number): City => ({
    id,
    name,
    nationId,
    level: 4,
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
    frontState: 1,
    defence: 100,
    defenceMax: 200,
    wall: 100,
    wallMax: 200,
    conflict: {},
    meta: {},
});

describe('monthly wandering nation cleanup', () => {
    it('matches legacy automatic disband resources, archive inputs, and logs after the opening limit', async () => {
        const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: { baseGold: 1_000, baseRice: 1_000 },
            environment: { mapName: 'test', unitSet: 'default' },
        };
        const state: TurnWorldState = {
            id: 1,
            currentYear: 195,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0195-01-01T00:00:00.000Z'),
            meta: {},
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig,
            scenarioMeta: {
                title: 'test',
                startYear: 193,
                life: null,
                fiction: null,
                history: [],
                ignoreDefaultEvents: false,
            },
            map: { id: 'test', name: 'test', cities: [] },
            diplomacy: [
                { fromNationId: 1, toNationId: 4, state: 2, term: 0, dead: 0, meta: {} },
                { fromNationId: 4, toNationId: 1, state: 2, term: 0, dead: 0, meta: {} },
            ],
            events: [],
            initialEvents: [],
            generals: [
                buildGeneral({
                    id: 1,
                    name: '방랑주',
                    nationId: 4,
                    cityId: 1,
                    officerLevel: 12,
                    npcState: 2,
                    gold: 2_000,
                    rice: 3_000,
                    belong: 7,
                    turnTime: new Date('0195-02-01T12:28:00.000Z'),
                }),
                buildGeneral({
                    id: 2,
                    name: '방랑객',
                    nationId: 4,
                    cityId: 1,
                    officerLevel: 1,
                    npcState: 0,
                    gold: 1_500,
                    rice: 4_000,
                    belong: 5,
                    turnTime: new Date('0195-02-01T12:53:00.000Z'),
                }),
                buildGeneral({
                    id: 3,
                    name: '존속장',
                    nationId: 1,
                    cityId: 2,
                    officerLevel: 12,
                    npcState: 2,
                    gold: 500,
                    rice: 500,
                    belong: 1,
                    turnTime: new Date('0195-02-01T13:21:00.000Z'),
                }),
            ],
            cities: [buildCity(1, '방랑성', 4), buildCity(2, '존속성', 1)],
            nations: [buildNation(1, '존속국', 1, 1), buildNation(4, '방랑국', 0, 2)],
            troops: [],
        };
        let world: InMemoryTurnWorld | null = null;
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createMonthlyWanderHandler({
                getWorld: () => world,
                startYear: 193,
                commandEnv: buildCommandEnv(scenarioConfig),
            }),
        });

        await world.advanceMonth(new Date('0195-02-01T00:00:00.000Z'));

        expect(world.getNationById(4)).toBeNull();
        expect(world.getGeneralById(1)).toMatchObject({
            nationId: 0,
            officerLevel: 0,
            gold: 1_000,
            rice: 1_000,
            lastTurn: { command: '해산', arg: {} },
            meta: { belong: 0, makelimit: 12 },
        });
        expect(world.getGeneralById(2)).toMatchObject({
            nationId: 0,
            officerLevel: 0,
            gold: 1_000,
            rice: 4_000,
            meta: { belong: 0, max_belong: 5 },
        });
        expect(world.getGeneralById(3)).toMatchObject({
            nationId: 1,
            officerLevel: 12,
            gold: 500,
            rice: 500,
        });
        expect(world.getCityById(1)).toMatchObject({ nationId: 0, frontState: 0 });
        expect(world.listDiplomacy()).toEqual([]);

        const changes = world.consumeDirtyState();
        expect(changes.deletedNations).toEqual([4]);
        expect(changes.deletedNationSnapshots).toEqual([
            expect.objectContaining({
                nation: expect.objectContaining({ id: 4, name: '방랑국' }),
                generalIds: [1, 2],
            }),
        ]);
        expect(changes.logs).toEqual([
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: '<R><b>【멸망】</b></><D><b>방랑국</b></>은 <R>멸망</>했습니다.',
                format: LogFormat.YEAR_MONTH,
            },
            {
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                generalId: 2,
                text: '<D><b>방랑국</b></>이 <R>멸망</>',
                format: LogFormat.YEAR_MONTH,
            },
            {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: 2,
                text: '<D><b>방랑국</b></>이 <R>멸망</>했습니다.',
                format: LogFormat.PLAIN,
            },
            {
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                generalId: 1,
                text: '<D><b>방랑국</b></>을 해산',
                format: LogFormat.YEAR_MONTH,
            },
            {
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                generalId: 1,
                text: '<D><b>방랑국</b></>이 <R>멸망</>',
                format: LogFormat.YEAR_MONTH,
            },
            {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: 1,
                text: '초반 제한후 방랑군은 자동 해산됩니다.',
                format: LogFormat.PLAIN,
            },
            {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: 1,
                text: '세력을 해산했습니다. <1>12:28</>',
                format: LogFormat.MONTH,
            },
            {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: 1,
                text: '<D><b>방랑국</b></>이 <R>멸망</>했습니다.',
                format: LogFormat.PLAIN,
            },
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.ACTION,
                text: '<Y>방랑주</>가 세력을 해산했습니다.',
                format: LogFormat.MONTH,
            },
        ]);
    });

    it('does not disband before startYear + 2', async () => {
        const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'default' },
        };
        const state: TurnWorldState = {
            id: 1,
            currentYear: 194,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0194-01-01T00:00:00.000Z'),
            meta: {},
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig,
            map: { id: 'test', name: 'test', cities: [] },
            diplomacy: [],
            events: [],
            initialEvents: [],
            generals: [
                buildGeneral({
                    id: 1,
                    name: '방랑주',
                    nationId: 4,
                    cityId: 1,
                    officerLevel: 12,
                    npcState: 2,
                    gold: 2_000,
                    rice: 3_000,
                    belong: 7,
                    turnTime: new Date('0194-02-01T12:28:00.000Z'),
                }),
            ],
            cities: [buildCity(1, '방랑성', 4)],
            nations: [buildNation(4, '방랑국', 0, 1)],
            troops: [],
        };
        let world: InMemoryTurnWorld | null = null;
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createMonthlyWanderHandler({
                getWorld: () => world,
                startYear: 193,
                commandEnv: buildCommandEnv(scenarioConfig),
            }),
        });

        await world.advanceMonth(new Date('0194-02-01T00:00:00.000Z'));

        expect(world.getNationById(4)).not.toBeNull();
        expect(world.getGeneralById(1)).toMatchObject({ nationId: 4, gold: 2_000, rice: 3_000 });
        expect(world.peekDirtyState().logs).toEqual([]);
    });
});
