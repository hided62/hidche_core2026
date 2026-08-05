import { describe, expect, it } from 'vitest';

import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { InMemoryTurnProcessor } from '../src/turn/inMemoryTurnProcessor.js';

const addMinutes = (time: Date, minutes: number): Date => new Date(time.getTime() + minutes * 60_000);

const buildGeneral = (id: number, turnTime: Date): TurnGeneral => ({
    id,
    name: `General_${id}`,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    turnTime,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    officerLevel: 5,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1000,
    rice: 1000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
});

describe('InMemoryTurnProcessor ordering', () => {
    it('executes generals by turnTime then id, not insertion order', async () => {
        const baseTime = new Date('0189-01-01T00:00:00Z');

        const generals: TurnGeneral[] = [
            buildGeneral(1, addMinutes(baseTime, 20)),
            {
                ...buildGeneral(2, addMinutes(baseTime, 10)),
                turnTick: 6_000_004,
                recentWarTime: null,
                recentWarTick: null,
            },
            buildGeneral(3, addMinutes(baseTime, 10)),
        ];

        const cities = [
            {
                id: 1,
                name: 'City_1',
                nationId: 1,
                viewName: 'City_1',
                agriculture: 100,
                agricultureMax: 2000,
                commerce: 100,
                commerceMax: 2000,
                security: 100,
                securityMax: 100,
                def: 100,
                defMax: 100,
                wall: 100,
                wallMax: 100,
                pop: 10000,
                popMax: 50000,
                trust: 50,
                supplyState: 1,
                frontState: 0,
                tradepoint: 0,
                level: 1,
                meta: {},
            },
        ];

        const nations = [
            {
                id: 1,
                name: 'TestNation',
                color: '#FF0000',
                capitalCityId: 1,
                chiefGeneralId: 1,
                gold: 10000,
                rice: 10000,
                power: 0,
                level: 1,
                typeCode: 'che_def',
                meta: {},
            },
        ];

        const map = {
            id: 'test_map',
            name: 'TestMap',
            cities: [
                {
                    id: 1,
                    name: 'City_1',
                    level: 1,
                    region: 1,
                    position: { x: 0, y: 0 },
                    connections: [],
                    max: {} as any,
                    initial: {} as any,
                },
            ],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        };

        const snapshot: TurnWorldSnapshot = {
            generals: generals as any,
            cities: cities as any,
            nations: nations as any,
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            map: map as any,
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test_map', unitSet: 'default' },
            },
            scenarioMeta: {
                startYear: 189,
            } as any,
            unitSet: {} as any,
        };

        const state: TurnWorldState = {
            id: 1,
            currentYear: 189,
            currentMonth: 1,
            tickSeconds: 3600,
            lastTurnTime: baseTime,
            meta: { lastGeneralId: 1 },
        };

        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            generalTurnHandler: {
                execute: ({ general }) => ({
                    general: general.id === 2 ? { ...general, recentWarTime: new Date(baseTime.getTime()) } : general,
                }),
            },
        });

        const executed: number[] = [];
        const processor = new InMemoryTurnProcessor(world, {
            tickMinutes: 10,
            beforeExecuteGeneral: async (general) => {
                executed.push(general.id);
            },
        });

        const budget = {
            budgetMs: 1000,
            maxGenerals: 10,
            catchUpCap: 1,
        };

        const boundaryResult = await processor.run(addMinutes(baseTime, 10), budget);
        expect(boundaryResult.processedTurns).toBe(1);
        expect(executed).toEqual([]);

        const tiedGeneralResult = await processor.run(new Date(addMinutes(baseTime, 10).getTime() + 1), budget);
        expect(tiedGeneralResult.processedTurns).toBe(0);
        expect(executed).toEqual([2, 3]);
        expect(world.getGeneralById(2)?.recentWarTime?.getTime()).toBe(baseTime.getTime());
        expect(world.getGeneralById(2)?.recentWarTick).not.toBeNull();
        expect(Number(world.getGeneralById(2)?.turnTick) % 10).toBe(4);

        await processor.run(addMinutes(baseTime, 30), budget);

        expect(executed).toEqual([2, 3, 1, 2, 3]);
        expect(world.getNextGeneralId()).toBe(4);
        expect(world.getNextGeneralId()).toBe(5);
        expect(world.getState().meta).toMatchObject({ lastGeneralId: 5 });

        const overdue = world.getGeneralById(1);
        expect(overdue).toBeDefined();
        overdue!.turnTime = addMinutes(baseTime, 5);
        const overdueResult = await processor.run(addMinutes(baseTime, 5), budget);
        expect(overdueResult.processedGenerals).toBe(1);
        expect(executed.at(-1)).toBe(1);
    });

    it('stops catch-up immediately after a calendar handler finalizes unification', async () => {
        const baseTime = new Date('0189-01-01T00:00:00Z');
        const snapshot = {
            generals: [],
            cities: [
                {
                    id: 1,
                    name: 'City_1',
                    nationId: 1,
                    level: 1,
                    population: 1,
                    populationMax: 1,
                    agriculture: 1,
                    agricultureMax: 1,
                    commerce: 1,
                    commerceMax: 1,
                    security: 1,
                    securityMax: 1,
                    defence: 1,
                    defenceMax: 1,
                    wall: 1,
                    wallMax: 1,
                    supplyState: 1,
                    frontState: 0,
                    state: 0,
                    meta: {},
                },
            ],
            nations: [
                {
                    id: 1,
                    name: 'TestNation',
                    color: '#FF0000',
                    capitalCityId: 1,
                    chiefGeneralId: null,
                    gold: 0,
                    rice: 0,
                    power: 0,
                    level: 1,
                    typeCode: 'che_def',
                    meta: {},
                },
            ],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            map: {
                id: 'test_map',
                name: 'TestMap',
                cities: [],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            },
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test_map', unitSet: 'default' },
            },
        } as TurnWorldSnapshot;
        const worldHolder: { current?: InMemoryTurnWorld } = {};
        const world = new InMemoryTurnWorld(
            {
                id: 1,
                currentYear: 189,
                currentMonth: 1,
                tickSeconds: 600,
                lastTurnTime: baseTime,
                meta: {},
            },
            snapshot,
            {
                schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
                calendarHandler: {
                    onMonthChanged: (): void => worldHolder.current?.updateWorldMeta({ isUnited: 2 }),
                },
            }
        );
        worldHolder.current = world;
        const processor = new InMemoryTurnProcessor(world, { tickMinutes: 10 });

        const result = await processor.run(addMinutes(baseTime, 50), {
            budgetMs: 1_000,
            maxGenerals: 10,
            catchUpCap: 10,
        });

        expect(result.processedTurns).toBe(1);
        expect(world.getState()).toMatchObject({ currentYear: 189, currentMonth: 2, meta: { isUnited: 2 } });
    });
});
