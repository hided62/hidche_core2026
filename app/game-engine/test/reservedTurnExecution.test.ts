import { describe, expect, it, vi } from 'vitest';
import type { TurnSchedule } from '@sammo-ts/logic';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { createReservedTurnHandler } from '../src/turn/reservedTurnHandler.js';
import { InMemoryTurnProcessor } from '../src/turn/inMemoryTurnProcessor.js';
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

    describe('Uprising and Founding Execution', () => {
        it('should execute uprising, fail founding in wrong city, fail domestic in wandering nation, then succeed founding and domestic', async () => {
            const mockDate = new Date('0189-01-01T00:00:00Z');
            // 1. Setup World Data
            const generals: TurnGeneral[] = [
                {
                    id: 1,
                    name: 'General_Leader',
                    nationId: 0,
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
                    name: 'General_Sub',
                    nationId: 0,
                    cityId: 1,
                    troopId: 0,
                    stats: { leadership: 70, strength: 70, intelligence: 70 },
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
                    name: 'Small_City',
                    nationId: 0,
                    viewName: 'Small_City',
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
                    level: 1, // Invalid for founding
                    meta: {},
                },
                {
                    id: 2,
                    name: 'Big_City',
                    nationId: 0,
                    viewName: 'Big_City',
                    agriculture: 100,
                    agricultureMax: 3000,
                    commerce: 100,
                    commerceMax: 3000,
                    security: 100,
                    securityMax: 100,
                    def: 100,
                    defMax: 100,
                    wall: 100,
                    wallMax: 100,
                    pop: 20000,
                    popMax: 80000,
                    trust: 50,
                    supplyState: 1,
                    frontState: 0,
                    tradepoint: 0,
                    level: 5, // Valid for founding
                    meta: {},
                },
            ];

            const localMap = {
                id: 'local_map',
                name: 'TestMap',
                cities: [
                    { id: 1, connections: [2] },
                    { id: 2, connections: [1] },
                ] as any,
            };

            const snapshot: TurnWorldSnapshot = {
                generals: generals as any,
                cities: cities as any,
                nations: [],
                troops: [],
                diplomacy: [],
                events: [],
                initialEvents: [],
                map: localMap,
                scenarioConfig: {
                    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                    iconPath: '',
                    map: {},
                    const: { openingPartYear: 9999 },
                    environment: { mapName: 'local', unitSet: 'default' },
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
                tickSeconds: 600,
                lastTurnTime: mockDate,
                meta: {},
            };

            const initialRows = [
                // Gen 1: Uprising -> Founding (Fail) -> Move -> Founding (Success)
                { generalId: 1, turnIdx: 0, actionCode: 'che_거병', arg: {} },
                {
                    generalId: 1,
                    turnIdx: 1,
                    actionCode: 'che_건국',
                    arg: { nationName: 'NewEmpire', nationType: 'che_def', colorType: 0 },
                },
                { generalId: 1, turnIdx: 2, actionCode: 'che_이동', arg: { destCityId: 2 } },
                {
                    generalId: 1,
                    turnIdx: 3,
                    actionCode: 'che_건국',
                    arg: { nationName: 'NewEmpire', nationType: 'che_def', colorType: 0 },
                },

                // Gen 2: Rest -> Appointment -> Domestic (Fail) -> Rest -> Domestic (Success)
                { generalId: 2, turnIdx: 0, actionCode: '휴식', arg: {} },
                { generalId: 2, turnIdx: 1, actionCode: 'che_임관', arg: { destNationId: 1 } },
                { generalId: 2, turnIdx: 2, actionCode: 'che_농지개간', arg: {} },
                { generalId: 2, turnIdx: 3, actionCode: '휴식', arg: {} },
                { generalId: 2, turnIdx: 4, actionCode: 'che_농지개간', arg: {} },
            ];

            const mockPrisma = createMockPrisma(initialRows);
            const reservedTurnStore = new InMemoryReservedTurnStore(mockPrisma as any, {
                maxGeneralTurns: 10,
                maxNationTurns: 10,
            });
            await reservedTurnStore.loadAll();

            const wrapper = { world: null as InMemoryTurnWorld | null };

            const handler = await createReservedTurnHandler({
                reservedTurns: reservedTurnStore,
                scenarioConfig: snapshot.scenarioConfig,
                scenarioMeta: snapshot.scenarioMeta,
                map: localMap,
                unitSet: snapshot.unitSet,
                getWorld: () => wrapper.world,
            });

            const world = new InMemoryTurnWorld(state, snapshot, {
                schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
                generalTurnHandler: handler,
            });
            wrapper.world = world;

            const processor = new InMemoryTurnProcessor(world, { tickMinutes: 10 });

            // Execution Loop
            // Turn 0: Uprising (Gen 1)
            await processor.run(new Date(mockDate.getTime() + 10 * 60 * 1000), {
                budgetMs: 1000,
                maxGenerals: 100,
                catchUpCap: 10,
            });
            await reservedTurnStore.flushChanges();

            // Verify Uprising
            const gen1 = world.getGeneralById(1)!;
            expect(gen1.nationId).toBeGreaterThan(0);
            const nation = world.getNationById(gen1.nationId)!;
            expect(nation.level).toBe(0); // Wandering
            expect(gen1.officerLevel).toBe(12); // Monarch

            // Gen 2 will perform Appointment in Turn 1

            // Turn 1: Founding (Fail) and Domestic (Fail)
            await processor.run(new Date(mockDate.getTime() + 2 * 10 * 60 * 1000), {
                // Skip enough time for turn
                budgetMs: 1000,
                maxGenerals: 100,
                catchUpCap: 10,
            });
            await reservedTurnStore.flushChanges();

            // Verify Failures
            // Founding should fail (Wrong City), so Nation Level should still be 0
            const nationAfterFail = world.getNationById(gen1.nationId)!;
            expect(nationAfterFail.level).toBe(0);

            // Turn 2: Move (Gen 1) and Domestic (Fail for Gen 2 - Wandering Nation)
            await processor.run(new Date(mockDate.getTime() + 3 * 10 * 60 * 1000), {
                budgetMs: 1000,
                maxGenerals: 100,
                catchUpCap: 10,
            });
            await reservedTurnStore.flushChanges();

            // Verify Turn 2
            const city1 = world.getCityById(1)!;
            expect(city1.agriculture).toBe(100); // Fail due to Wandering Nation (level 0)

            const gen1AfterMove = world.getGeneralById(1)!;
            expect(gen1AfterMove.cityId).toBe(2);
            const gen2AfterMove = world.getGeneralById(2)!;
            expect(gen2AfterMove.cityId).toBe(2);

            // Turn 3: Founding (Success in City 2)
            await processor.run(new Date(mockDate.getTime() + 4 * 10 * 60 * 1000), {
                budgetMs: 1000,
                maxGenerals: 100,
                catchUpCap: 10,
            });
            await reservedTurnStore.flushChanges();

            // Verify Founding
            const nationFinal = world.getNationById(gen1.nationId)!;
            expect(nationFinal.level).toBe(1); // Normal Nation
            expect(nationFinal.name).toBe('NewEmpire');
            expect(nationFinal.capitalCityId).toBe(2);

            // Turn 4: Domestic (Success, Gen 2 in City 2)
            // Gen 2 is in City 2, which was claimed by the monarch's move.
            // Nation is now level 1, so Domestic should pass.

            await processor.run(new Date(mockDate.getTime() + 5 * 10 * 60 * 1000), {
                budgetMs: 1000,
                maxGenerals: 100,
                catchUpCap: 10,
            });
            await reservedTurnStore.flushChanges();

            const city2Final = world.getCityById(2)!;
            expect(city2Final.agriculture).toBeGreaterThan(100); // Success
        });
    });
});
