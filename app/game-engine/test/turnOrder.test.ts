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
    meta: {},
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
            buildGeneral(2, addMinutes(baseTime, 10)),
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
            meta: {},
        };

        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });

        const executed: number[] = [];
        const processor = new InMemoryTurnProcessor(world, {
            tickMinutes: 10,
            beforeExecuteGeneral: async (general) => {
                executed.push(general.id);
            },
        });

        await processor.run(addMinutes(baseTime, 30), {
            budgetMs: 1000,
            maxGenerals: 10,
            catchUpCap: 1,
        });

        expect(executed).toEqual([2, 3, 1]);
    });
});
