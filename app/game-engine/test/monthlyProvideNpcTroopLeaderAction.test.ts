import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';
import { describe, expect, it, vi } from 'vitest';
import type { City, Nation } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createProvideNpcTroopLeaderHandler } from '../src/turn/monthlyProvideNpcTroopLeaderAction.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildCity = (id: number, nationId: number): City => ({
    id,
    name: `도시${id}`,
    nationId,
    level: 4,
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

const buildNation = (id: number, level: number): Nation => ({
    id,
    name: `국가${id}`,
    color: '#777777',
    capitalCityId: id,
    chiefGeneralId: null,
    gold: 0,
    rice: 0,
    power: 0,
    level,
    typeCode: 'che_중립',
    meta: {},
});

const buildGeneral = (id: number, nationId: number, npcState = 0): TurnGeneral => ({
    id,
    userId: null,
    name: `장수${id}`,
    nationId,
    cityId: nationId,
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
    npcState,
    bornYear: 170,
    deadYear: 250,
    affinity: 1,
    picture: 'default.jpg',
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    lastTurn: { command: '휴식' },
    turnTime: new Date('0200-01-01T00:00:00.000Z'),
    recentWarTime: null,
    meta: { killturn: 1_000 },
});

const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
    iconPath: '.',
    map: {},
    const: {},
    environment: { mapName: 'test', unitSet: 'default' },
};

describe('ProvideNPCTroopLeader monthly action', () => {
    it('fills each nation level quota and creates matching troops and 30 assembly turns', async () => {
        const state: TurnWorldState = {
            id: 1,
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
            meta: {
                hiddenSeed: process.env.REF_HIDDEN_SEED ?? 'troop-leader-fixture',
                lastNPCTroopLeaderID: 8,
            },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig,
            map: { id: 'test', name: 'test', cities: [] },
            generals: [buildGeneral(1, 1), buildGeneral(2, 2, 5)],
            cities: [buildCity(1, 1), buildCity(2, 1)],
            nations: [buildNation(1, 3), buildNation(2, 2)],
            troops: [],
            diplomacy: [],
            events: [],
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
        const handler = createProvideNpcTroopLeaderHandler({
            getWorld: () => world,
            reservedTurns,
            env: buildCommandEnv(scenarioConfig),
        });

        await handler(
            [],
            {
                year: 200,
                month: 1,
                startyear: 190,
                currentEventID: 1,
                turnTime: state.lastTurnTime,
            },
            { id: 1, targetCode: 'month', priority: 1, condition: true, action: [], meta: {} }
        );

        const created = world.peekDirtyState().createdGenerals;
        expect(created).toHaveLength(3);
        expect(created.map((general) => general.name)).toEqual([
            '㉥부대장   9',
            '㉥부대장  10',
            '㉥부대장  11',
        ]);
        expect(created[0]).toMatchObject({
            nationId: 1,
            cityId: process.env.REF_HIDDEN_SEED ? 2 : 1,
            troopId: 3,
            stats: { leadership: 10, strength: 10, intelligence: 10 },
            experience: 2_000,
            dedication: 2_000,
            officerLevel: 1,
            role: { personality: 'che_은둔' },
            gold: 0,
            rice: 0,
            age: 20,
            npcState: 5,
            bornYear: 180,
            deadYear: 260,
            affinity: 999,
            meta: { killturn: 70, specage: 999, specage2: 999 },
        });
        expect(world.peekDirtyState().createdTroops).toEqual(
            created.map((general) => ({
                id: general.id,
                nationId: general.nationId,
                name: general.name,
            }))
        );
        for (const general of created) {
            expect(reservedTurns.getGeneralTurns(general.id)).toEqual(
                Array.from({ length: 30 }, () => ({ action: 'che_집합', args: {} }))
            );
        }
        expect(world.getState().meta.lastNPCTroopLeaderID).toBe(11);
        if (process.env.REF_HIDDEN_SEED) {
            const probe = new RandUtil(
                new LiteHashDRBG(simpleSerialize(process.env.REF_HIDDEN_SEED, 'troopLeader', 200, 1, 1))
            );
            expect([
                probe.choice([1, 2]),
                probe.nextRangeInt(0, 599),
                probe.nextRangeInt(0, 999_999),
            ]).toEqual([2, 567, 821_811]);
            expect(
                created.map((general) => ({
                    cityId: general.cityId,
                    turnTime: general.turnTime.toISOString(),
                }))
            ).toEqual([
                { cityId: 2, turnTime: '0200-01-01T00:09:27.821Z' },
                { cityId: 1, turnTime: '0200-01-01T00:01:59.665Z' },
                { cityId: 2, turnTime: '0200-01-01T00:07:50.470Z' },
            ]);
        }
    });
});
