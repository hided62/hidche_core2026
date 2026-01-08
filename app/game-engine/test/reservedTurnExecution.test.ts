import { describe, expect, it, vi } from 'vitest';
import type { TurnSchedule } from '@sammo-ts/logic';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { createReservedTurnHandler } from '../src/turn/reservedTurnHandler.js';
// Inline MINIMAL_MAP to avoid cross-package relative import issues
const MINIMAL_MAP = {
    id: 'minimal_map',
    name: '최소형맵',
    cities: [
        {
            id: 1,
            name: '소성A',
            level: 1,
            region: 1,
            position: { x: 50, y: 10 },
            connections: [2, 3, 5, 6, 8],
            max: { population: 20000, agriculture: 2000, commerce: 2000, security: 2000, defence: 500, wall: 500 },
            initial: { population: 5000, agriculture: 100, commerce: 100, security: 100, defence: 100, wall: 100 },
        },
        {
            id: 2,
            name: '중성B',
            level: 2,
            region: 2,
            position: { x: 20, y: 30 },
            connections: [1, 4, 5, 6, 9],
            max: { population: 30000, agriculture: 3000, commerce: 3000, security: 3000, defence: 600, wall: 600 },
            initial: { population: 8000, agriculture: 200, commerce: 200, security: 200, defence: 200, wall: 200 },
        },
        // ... (other cities if needed, but test only uses 1 and 2)
    ],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

// --- Mocks & Helpers ---

const mockDate = new Date('189-01-01T00:00:00Z');

// We need a mock Prisma client that satisfies the shape required by InMemoryReservedTurnStore
// It expects { generalTurn: { findMany, deleteMany, createMany }, nationTurn: { ... } }
const createMockPrisma = (initialGeneralRows: any[] = []) => {
    let generalRows = [...initialGeneralRows];
    return {
        generalTurn: {
            findMany: vi.fn(async ({ where } = {}) => {
                if (where?.generalId) {
                    return generalRows
                        .filter((r) => r.generalId === where.generalId)
                        .sort((a, b) => a.turnIdx - b.turnIdx);
                }
                return generalRows;
            }),
            deleteMany: vi.fn(async ({ where } = {}) => {
                if (where?.generalId) {
                    generalRows = generalRows.filter((r) => r.generalId !== where.generalId);
                }
                return { count: 0 };
            }),
            createMany: vi.fn(async ({ data }) => {
                if (Array.isArray(data)) {
                    generalRows.push(...data);
                }
                return { count: data.length };
            }),
        },
        nationTurn: {
            findMany: vi.fn(async () => []),
            deleteMany: vi.fn(async () => ({ count: 0 })),
            createMany: vi.fn(async () => ({ count: 0 })),
        },
    };
};

describe('Reserved Turn Execution Integration', () => {
    it('should execute reserved turns and update world state', async () => {
        // 1. Setup World Data
        const generals: TurnGeneral[] = [
            {
                id: 1,
                name: 'General_0',
                nationId: 1,
                cityId: 1,
                troopId: 0,
                stats: { leadership: 80, strength: 80, intelligence: 80 },
                turnTime: mockDate,
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
                gold: 2000,
                rice: 2000,
                crew: 0,
                crewTypeId: 0,
                train: 0,
                atmos: 0,
                age: 30,
                npcState: 0,
            },
            {
                id: 2,
                name: 'General_1',
                nationId: 1,
                cityId: 1,
                troopId: 0,
                stats: { leadership: 80, strength: 80, intelligence: 80 },
                turnTime: mockDate,
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
                gold: 2000,
                rice: 2000,
                crew: 0,
                crewTypeId: 0,
                train: 0,
                atmos: 0,
                age: 30,
                npcState: 0,
            },
        ];

        const cities = [
            {
                id: 1,
                name: 'City_1',
                nationId: 1,
                viewName: 'City_1',
                agric: 100, // old prop name check? No, interface uses agriculture
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
                supplyState: 1, // Correct property name
                frontState: 0,
                tradepoint: 0,
                meta: {},
            },
            {
                id: 2,
                name: 'City_2',
                nationId: 1,
                viewName: 'City_2',
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
                supplyState: 1, // Correct property name
                frontState: 0,
                tradepoint: 0,
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

        const snapshot: TurnWorldSnapshot = {
            generals: generals as any,
            cities: cities as any,
            nations: nations as any,
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            map: MINIMAL_MAP,
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'minimal', unitSet: 'default' },
            },
            scenarioMeta: {
                startYear: 189,
                // Add other required props if any
            } as any,
            unitSet: {
                // mock unit set
            } as any,
        };

        const state: TurnWorldState = {
            id: 1,
            currentYear: 189,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: mockDate,
            meta: {},
        };

        const schedule: TurnSchedule = {
            entries: [{ startMinute: 0, tickMinutes: 10 }],
        };

        // 2. Setup Reserved Turns
        // Gen 1: Agriculture (x2) -> Move City 2
        // Gen 2: Commerce (x2) -> Train
        const initialRows = [
            { generalId: 1, turnIdx: 0, actionCode: 'che_농지개간', arg: {} },
            { generalId: 1, turnIdx: 1, actionCode: 'che_농지개간', arg: {} },
            { generalId: 1, turnIdx: 2, actionCode: 'che_이동', arg: { destCityId: 2 } },

            { generalId: 2, turnIdx: 0, actionCode: 'che_상업투자', arg: {} },
            { generalId: 2, turnIdx: 1, actionCode: 'che_상업투자', arg: {} },
            { generalId: 2, turnIdx: 2, actionCode: 'che_훈련', arg: {} },
        ];

        const mockPrisma = createMockPrisma(initialRows);
        const reservedTurnStore = new InMemoryReservedTurnStore(mockPrisma as any, {
            maxGeneralTurns: 10,
            maxNationTurns: 10,
        });
        await reservedTurnStore.loadAll();

        // 3. Setup Handler & World (Circular dependency resolution)
        const wrapper = { world: null as InMemoryTurnWorld | null };

        const handler = await createReservedTurnHandler({
            reservedTurns: reservedTurnStore,
            scenarioConfig: snapshot.scenarioConfig,
            scenarioMeta: snapshot.scenarioMeta,
            map: MINIMAL_MAP,
            unitSet: snapshot.unitSet,
            getWorld: () => wrapper.world,
        });

        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule,
            generalTurnHandler: handler,
        });
        wrapper.world = world;

        // 4. Run Execution Loop (3 Turns)
        const limitTurns = 3;
        for (let i = 0; i < limitTurns; i++) {
            const activeGenerals = world.listGenerals();

            // In real engine, we might sort by turn time.
            // Here assuming synchronous execution for test simplicity
            for (const gen of activeGenerals) {
                world.executeGeneralTurn(gen);
            }

            // Flush changes to mock DB (simulate persistence)
            await reservedTurnStore.flushChanges();
        }

        // 5. Verify Results
        const finalGen1 = world.getGeneralById(1)!;
        const finalGen2 = world.getGeneralById(2)!;
        const finalCity1 = world.getCityById(1)!;

        // Gen 1 moved to City 2?
        expect(finalGen1.cityId).toBe(2);

        // Gen 2 stayed in City 1?
        expect(finalGen2.cityId).toBe(1);

        // City 1 Agric increased (100 -> 300)
        expect(finalCity1.agriculture).toBeGreaterThanOrEqual(300);

        // City 1 Commerce increased (100 -> ~178)
        expect(finalCity1.commerce).toBeGreaterThanOrEqual(170);

        // Gen 1 reserved turns should be shifted and empty/default
        const gen1Turns = reservedTurnStore.getGeneralTurns(1);
        expect(gen1Turns[0].action).toBe('휴식'); // Since we consumed 3 turns, next should be rest (default)
        // Wait, initial had 3 items. After 3 turns:
        // Turn 0 exec -> Shift -1
        // Turn 1 exec -> Shift -1
        // Turn 2 exec -> Shift -1
        // Turns should indeed be empty/default now.
    });
});
