import { describe, expect, it, vi } from 'vitest';
import type { TurnSchedule } from '@sammo-ts/logic';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { createReservedTurnHandler } from '../src/turn/reservedTurnHandler.js';
import { InMemoryTurnProcessor } from '../src/turn/inMemoryTurnProcessor.js';

const mockDate = new Date('0189-01-01T00:00:00Z');

const MINIMAL_MAP = {
    id: 'npc_domestic_map',
    name: 'NPC내정맵',
    cities: [
        {
            id: 1,
            name: '소성A',
            level: 1,
            region: 1,
            position: { x: 10, y: 10 },
            connections: [2],
            max: {
                population: 20000,
                agriculture: 2000,
                commerce: 2000,
                security: 2000,
                defence: 1000,
                wall: 1000,
            },
            initial: {
                population: 10000,
                agriculture: 1000,
                commerce: 1000,
                security: 1000,
                defence: 500,
                wall: 500,
            },
        },
        {
            id: 2,
            name: '중성B',
            level: 1,
            region: 2,
            position: { x: 20, y: 10 },
            connections: [1],
            max: {
                population: 20000,
                agriculture: 2000,
                commerce: 2000,
                security: 2000,
                defence: 1000,
                wall: 1000,
            },
            initial: {
                population: 10000,
                agriculture: 1000,
                commerce: 1000,
                security: 1000,
                defence: 500,
                wall: 500,
            },
        },
    ],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const createMockPrisma = (initialGeneralRows: any[] = []) => {
    let generalRows = [...initialGeneralRows];
    return {
        generalTurn: {
            findMany: vi.fn(async ({ where } = {}) => {
                if (where?.generalId) {
                    return generalRows
                        .filter((row) => row.generalId === where.generalId)
                        .sort((a, b) => a.turnIdx - b.turnIdx);
                }
                return generalRows;
            }),
            deleteMany: vi.fn(async ({ where } = {}) => {
                if (where?.generalId) {
                    generalRows = generalRows.filter((row) => row.generalId !== where.generalId);
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

const addMinutes = (time: Date, minutes: number): Date => new Date(time.getTime() + minutes * 60_000);

describe('NPC 일반 내정 턴', () => {
    it('고정 seed에서 예약 턴 없이 치안 명령을 실행하고 다음 턴으로 이동한다', async () => {
        const generals: TurnGeneral[] = [
            {
                id: 1,
                name: 'NPC_무장',
                nationId: 1,
                cityId: 1,
                troopId: 0,
                stats: { leadership: 75, strength: 75, intelligence: 15 },
                turnTime: mockDate,
                role: {
                    items: { horse: null, weapon: null, book: null, item: null },
                    personality: null,
                    specialDomestic: null,
                    specialWar: null,
                },
                triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
                meta: { killturn: 999 },
                officerLevel: 4,
                experience: 0,
                dedication: 0,
                injury: 0,
                gold: 0,
                rice: 0,
                crew: 0,
                crewTypeId: 0,
                train: 0,
                atmos: 0,
                age: 30,
                npcState: 2,
            },
        ];

        const cities = [
            {
                id: 1,
                name: '소성A',
                nationId: 1,
                level: 1,
                state: 0,
                population: 10000,
                populationMax: 20000,
                agriculture: 1000,
                agricultureMax: 2000,
                commerce: 1000,
                commerceMax: 2000,
                security: 1000,
                securityMax: 2000,
                supplyState: 1,
                frontState: 0,
                defence: 500,
                defenceMax: 1000,
                wall: 500,
                wallMax: 1000,
                meta: { trust: 98 },
            },
            {
                id: 2,
                name: '중성B',
                nationId: 2,
                level: 1,
                state: 0,
                population: 12000,
                populationMax: 20000,
                agriculture: 1200,
                agricultureMax: 2000,
                commerce: 1200,
                commerceMax: 2000,
                security: 1200,
                securityMax: 2000,
                supplyState: 1,
                frontState: 0,
                defence: 600,
                defenceMax: 1000,
                wall: 600,
                wallMax: 1000,
                meta: { trust: 98 },
            },
        ];

        const nations = [
            {
                id: 1,
                name: 'NPC국가',
                color: '#FF0000',
                capitalCityId: 1,
                chiefGeneralId: 1,
                gold: 50000,
                rice: 50000,
                power: 0,
                level: 1,
                typeCode: 'che_def',
                meta: {},
            },
            {
                id: 2,
                name: '경쟁국',
                color: '#0000FF',
                capitalCityId: 2,
                chiefGeneralId: null,
                gold: 50000,
                rice: 50000,
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
            map: MINIMAL_MAP as any,
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'npc_domestic_map', unitSet: 'default' },
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
            meta: { seed: 1 },
        };

        const schedule: TurnSchedule = {
            entries: [{ startMinute: 0, tickMinutes: 10 }],
        };

        const mockPrisma = createMockPrisma();
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
            map: MINIMAL_MAP as any,
            unitSet: snapshot.unitSet,
            getWorld: () => wrapper.world,
        });

        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule,
            generalTurnHandler: handler,
        });
        wrapper.world = world;

        const beforeCity = world.getCityById(1)!;
        const beforeStats = {
            population: beforeCity.population,
            agriculture: beforeCity.agriculture,
            commerce: beforeCity.commerce,
            security: beforeCity.security,
            defence: beforeCity.defence,
            wall: beforeCity.wall,
        };

        const processor = new InMemoryTurnProcessor(world, { tickMinutes: 10 });
        await processor.run(addMinutes(mockDate, 10), {
            budgetMs: 1000,
            maxGenerals: 10,
            catchUpCap: 1,
        });

        const afterCity = world.getCityById(1)!;
        expect(afterCity).toMatchObject({
            ...beforeStats,
            // 레거시 내정 수식과 고정 seed의 치명/실패 배율을 적용한 값.
            security: 1063,
        });
        expect(world.getGeneralById(1)!.turnTime.getTime()).toBe(addMinutes(mockDate, 10).getTime());
    });
});
