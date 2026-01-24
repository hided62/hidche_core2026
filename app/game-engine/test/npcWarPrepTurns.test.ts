import { describe, expect, it, vi } from 'vitest';
import type { TurnSchedule, UnitSetDefinition } from '@sammo-ts/logic';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { createReservedTurnHandler } from '../src/turn/reservedTurnHandler.js';
import { InMemoryTurnProcessor } from '../src/turn/inMemoryTurnProcessor.js';
import { composeCalendarHandlers } from '../src/turn/calendarHandlers.js';
import { createIncomeHandler } from '../src/turn/incomeHandler.js';
import { createNpcTaxHandler } from '../src/turn/npcTaxHandler.js';
import { createFrontStateHandler } from '../src/turn/frontStateHandler.js';
import { LARGE_TEST_MAP, buildLargeTestCities } from './fixtures/largeTestMap.js';

const mockDate = new Date('0182-07-01T00:00:00Z');

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

const createNpcGeneral = (
    id: number,
    cityId: number,
    nationId: number,
    officerLevel: number,
    stats: { leadership: number; strength: number; intelligence: number }
): TurnGeneral => ({
    id,
    name: `NPC_${id}`,
    nationId,
    cityId,
    troopId: 0,
    stats,
    turnTime: mockDate,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: {},
    officerLevel,
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
    npcState: 2,
});

const maxCityStats = (city: ReturnType<typeof buildLargeTestCities>[number]) => ({
    ...city,
    population: city.populationMax,
    agriculture: city.agricultureMax,
    commerce: city.commerceMax,
    security: city.securityMax,
    defence: city.defenceMax,
    wall: city.wallMax,
    meta: { ...(city.meta ?? {}), trust: 100, trade: 100 },
});

describe('NPC 전투준비 턴 검증', () => {
    it('182년 9/10월에 훈련/사기진작이 실행되어야 한다', async () => {
        const cities = buildLargeTestCities().map(maxCityStats);
        const smallMedium = LARGE_TEST_MAP.cities.filter((city) => [5, 6].includes(city.level));
        const nationACityId = smallMedium[0]!.id;
        const nationBCityId = smallMedium[1]!.id;

        const cityA = cities.find((city) => city.id === nationACityId)!;
        const cityB = cities.find((city) => city.id === nationBCityId)!;
        cityA.nationId = 1;
        cityB.nationId = 2;

        const unitSet: UnitSetDefinition = {
            id: 'test_unit_set',
            name: 'TestUnitSet',
            defaultCrewTypeId: 1100,
            crewTypes: [
                {
                    id: 1100,
                    armType: 1,
                    name: '보병',
                    attack: 10,
                    defence: 10,
                    speed: 10,
                    avoid: 0,
                    magicCoef: 0,
                    cost: 10,
                    rice: 1,
                    requirements: [],
                    attackCoef: {},
                    defenceCoef: {},
                    info: [],
                    initSkillTrigger: null,
                    phaseSkillTrigger: null,
                    iActionList: null,
                },
            ],
        };

        const generals: TurnGeneral[] = [];
        generals.push(createNpcGeneral(1, nationACityId, 1, 12, { leadership: 75, strength: 70, intelligence: 40 }));
        for (let i = 2; i <= 6; i += 1) {
            generals.push(
                createNpcGeneral(i, nationACityId, 1, 2, { leadership: 75, strength: 70, intelligence: 40 })
            );
        }
        generals.push(createNpcGeneral(100, nationBCityId, 2, 12, { leadership: 70, strength: 60, intelligence: 60 }));

        const snapshot: TurnWorldSnapshot = {
            generals: generals as any,
            cities: cities as any,
            nations: [
                {
                    id: 1,
                    name: 'NPC_A',
                    color: '#AA0000',
                    capitalCityId: nationACityId,
                    chiefGeneralId: 1,
                    gold: 0,
                    rice: 0,
                    power: 0,
                    level: 1,
                    typeCode: 'npc',
                    meta: { tech: 0 },
                },
                {
                    id: 2,
                    name: 'NPC_B',
                    color: '#0000AA',
                    capitalCityId: nationBCityId,
                    chiefGeneralId: 100,
                    gold: 0,
                    rice: 0,
                    power: 0,
                    level: 1,
                    typeCode: 'npc',
                    meta: { tech: 0 },
                },
            ],
            troops: [],
            diplomacy: [
                { fromNationId: 1, toNationId: 2, state: 1, term: 8, dead: 0, meta: {} },
                { fromNationId: 2, toNationId: 1, state: 1, term: 8, dead: 0, meta: {} },
            ],
            events: [],
            initialEvents: [],
            map: LARGE_TEST_MAP as any,
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {
                    openingPartYear: 3,
                    develCost: 10,
                    baseGold: 1000,
                    baseRice: 1000,
                    maxResourceActionAmount: 10000,
                    minAvailableRecruitPop: 0,
                },
                environment: { mapName: 'large_test_map', unitSet: 'default' },
            },
            scenarioMeta: { startYear: 180 } as any,
            unitSet: unitSet as any,
        };

        const state: TurnWorldState = {
            id: 1,
            currentYear: 182,
            currentMonth: 7,
            tickSeconds: 600,
            lastTurnTime: mockDate,
            meta: { seed: 1, initYear: 182, initMonth: 7 },
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

        for (const general of generals.filter((g) => g.nationId === 1)) {
            const turns = reservedTurnStore.getGeneralTurns(general.id);
            turns[0] = {
                action: 'che_징병',
                args: {
                    crewType: unitSet.defaultCrewTypeId,
                    amount: general.stats.leadership * 100,
                },
            };
        }

        const wrapper = { world: null as InMemoryTurnWorld | null };
        const trainingActions = new Set(['che_훈련', 'che_사기진작']);
        const trainingCounts = new Map<string, number>();

        const handler = await createReservedTurnHandler({
            reservedTurns: reservedTurnStore,
            scenarioConfig: snapshot.scenarioConfig,
            scenarioMeta: snapshot.scenarioMeta,
            map: LARGE_TEST_MAP as any,
            unitSet: snapshot.unitSet,
            getWorld: () => wrapper.world,
            onActionResolved: (payload) => {
                if (payload.kind !== 'general') {
                    return;
                }
                if (!trainingActions.has(payload.actionKey)) {
                    return;
                }
                const world = wrapper.world;
                if (!world) {
                    return;
                }
                const { currentYear, currentMonth } = world.getState();
                const key = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
                trainingCounts.set(key, (trainingCounts.get(key) ?? 0) + 1);
            },
        });

        const tracedHandler = {
            execute: (ctx: Parameters<typeof handler.execute>[0]) => {
                return handler.execute(ctx);
            },
        };

        const incomeHandler = createIncomeHandler({
            getWorld: () => wrapper.world,
            scenarioConfig: snapshot.scenarioConfig,
            nationTraits: new Map(),
        });

        const npcTaxHandler = createNpcTaxHandler({
            getWorld: () => wrapper.world,
        });

        const frontStateHandler = createFrontStateHandler({
            getWorld: () => wrapper.world,
            map: LARGE_TEST_MAP,
        });

        const calendarHandler = composeCalendarHandlers(incomeHandler, npcTaxHandler, frontStateHandler);

        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule,
            generalTurnHandler: tracedHandler,
            calendarHandler,
        });
        wrapper.world = world;

        const processor = new InMemoryTurnProcessor(world, {
            tickMinutes: 10,
        });

        const runOneMonth = async () => {
            const target = addMinutes(world.getState().lastTurnTime, 10);
            await processor.run(target, {
                budgetMs: 10000,
                maxGenerals: 100000,
                catchUpCap: 1,
            });
        };

        while (true) {
            await runOneMonth();
            const { currentYear, currentMonth } = world.getState();
            if (currentYear > 182 || (currentYear === 182 && currentMonth >= 11)) {
                break;
            }
        }

        expect(trainingCounts.get('182-09') ?? 0).toBeGreaterThan(0);
        expect(trainingCounts.get('182-10') ?? 0).toBeGreaterThan(0);
    });
});
