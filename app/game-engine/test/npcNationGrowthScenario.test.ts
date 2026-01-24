import { describe, expect, it, vi } from 'vitest';
import type { TurnSchedule, UnitSetDefinition } from '@sammo-ts/logic';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { createReservedTurnHandler } from '../src/turn/reservedTurnHandler.js';
import { InMemoryTurnProcessor } from '../src/turn/inMemoryTurnProcessor.js';
import { createIncomeHandler } from '../src/turn/incomeHandler.js';
import { LARGE_TEST_MAP, buildLargeTestCities } from './fixtures/largeTestMap.js';

const mockDate = new Date('0179-08-01T00:00:00Z');

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
    stats: { leadership: number; strength: number; intelligence: number },
    npcState: number
): TurnGeneral => ({
    id,
    name: `NPC_${id}`,
    nationId: 0,
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
    officerLevel: 1,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 5000,
    rice: 5000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState,
});

describe('NPC 대형 시뮬레이션', () => {
    it('NPC 국가 성장 기준을 만족해야 한다', async () => {
        const smallMediumCityIds = LARGE_TEST_MAP.cities
            .filter((city) => [4, 5].includes(city.level))
            .map((city) => city.id);

        const npcPerType = smallMediumCityIds.length * 20;
        const generals: TurnGeneral[] = [];

        for (let i = 0; i < npcPerType; i += 1) {
            const cityId = smallMediumCityIds[i % smallMediumCityIds.length];
            generals.push(
                createNpcGeneral(
                    generals.length + 1,
                    cityId,
                    { leadership: 75, strength: 75, intelligence: 10 },
                    2
                )
            );
        }

        for (let i = 0; i < npcPerType; i += 1) {
            const cityId = smallMediumCityIds[i % smallMediumCityIds.length];
            generals.push(
                createNpcGeneral(
                    generals.length + 1,
                    cityId,
                    { leadership: 75, strength: 10, intelligence: 75 },
                    3
                )
            );
        }

        const cities = buildLargeTestCities();

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

        const snapshot: TurnWorldSnapshot = {
            generals: generals as any,
            cities: cities as any,
            nations: [],
            troops: [],
            diplomacy: [],
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
                },
                environment: { mapName: 'large_test_map', unitSet: 'default' },
            },
            scenarioMeta: {
                startYear: 180,
            } as any,
            unitSet: unitSet as any,
        };

        const state: TurnWorldState = {
            id: 1,
            currentYear: 179,
            currentMonth: 8,
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
            map: LARGE_TEST_MAP as any,
            unitSet: snapshot.unitSet,
            getWorld: () => wrapper.world,
        });

        const incomeHandler = createIncomeHandler({
            getWorld: () => wrapper.world,
            scenarioConfig: snapshot.scenarioConfig,
            nationTraits: new Map(),
        });

        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule,
            generalTurnHandler: handler,
            calendarHandler: incomeHandler,
        });
        wrapper.world = world;

        const processor = new InMemoryTurnProcessor(world, { tickMinutes: 10 });
        const checkpointGoldByGeneral = new Map<number, number>();

        const runOneMonth = async () => {
            const target = addMinutes(world.getState().lastTurnTime, 10);
            await processor.run(target, {
                budgetMs: 10000,
                maxGenerals: 100000,
                catchUpCap: 1,
            });
        };

        const assertUprisingCount = (minCount: number) => {
            const nations = world.listNations();
            expect(nations.length).toBeGreaterThanOrEqual(minCount);
        };

        const assertFoundedCount = (minCount: number) => {
            const nations = world.listNations().filter((nation) => nation.level >= 1 && nation.capitalCityId);
            expect(nations.length).toBeGreaterThanOrEqual(minCount);
        };

        const assertTaxRateUnder = (limit: number) => {
            const founded = world.listNations().filter((nation) => nation.level >= 1 && nation.capitalCityId);
            for (const nation of founded) {
                const rate = typeof nation.meta.rate === 'number' ? nation.meta.rate : 20;
                expect(rate).toBeLessThan(limit);
            }
        };

        const assertSmallMediumCitiesFounded = () => {
            const targetCities = world
                .listCities()
                .filter((city) => [4, 5].includes(city.level));
            for (const city of targetCities) {
                expect(city.nationId).toBeGreaterThan(0);
            }
        };

        const assertCityTrust = (minTrust: number) => {
            const targetCities = world.listCities().filter((city) => city.nationId > 0);
            for (const city of targetCities) {
                const trust = typeof city.meta.trust === 'number' ? city.meta.trust : 0;
                expect(trust).toBeGreaterThanOrEqual(minTrust);
            }
        };

        const assertNationGeneralCount = (targetCount: number) => {
            const nations = world.listNations().filter((nation) => nation.level >= 1 && nation.capitalCityId);
            const generals = world.listGenerals();
            for (const nation of nations) {
                const nationGenerals = generals.filter((general) => general.nationId === nation.id);
                expect(nationGenerals.length).toBe(targetCount);
            }
        };

        const assertNationRecruitCount = (minRecruit: number) => {
            const nations = world.listNations().filter((nation) => nation.level >= 1 && nation.capitalCityId);
            const generals = world.listGenerals();
            for (const nation of nations) {
                const recruited = generals.filter(
                    (general) => general.nationId === nation.id && general.crew > 0 && general.crewTypeId > 0
                );
                expect(recruited.length).toBeGreaterThanOrEqual(minRecruit);
            }
        };

        const maybeSnapshotGold = () => {
            checkpointGoldByGeneral.clear();
            for (const general of world.listGenerals()) {
                if (general.nationId > 0) {
                    checkpointGoldByGeneral.set(general.id, general.gold);
                }
            }
        };

        const assertGoldIncome = () => {
            const generals = world.listGenerals().filter((general) => general.nationId > 0);
            let beforeTotal = 0;
            let afterTotal = 0;
            for (const general of generals) {
                beforeTotal += checkpointGoldByGeneral.get(general.id) ?? 0;
                afterTotal += general.gold;
            }
            expect(afterTotal).toBeGreaterThan(beforeTotal);
        };

        const targetChecks = new Map<string, () => void>([
            ['179-09', () => assertUprisingCount(1)],
            ['179-10', () => assertUprisingCount(2)],
            ['179-11', () => assertFoundedCount(1)],
            ['179-12', () => {
                assertTaxRateUnder(15);
                maybeSnapshotGold();
            }],
            ['180-01', () => assertGoldIncome()],
            ['180-07', () => assertSmallMediumCitiesFounded()],
            ['180-11', () => assertCityTrust(90)],
            ['181-01', () => assertNationGeneralCount(10)],
            ['182-10', () => assertNationRecruitCount(5)],
        ]);

        const toKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

        while (true) {
            await runOneMonth();
            const { currentYear, currentMonth } = world.getState();
            const key = toKey(currentYear, currentMonth);
            const checker = targetChecks.get(key);
            if (checker) {
                checker();
            }
            if (currentYear > 182 || (currentYear === 182 && currentMonth >= 10)) {
                break;
            }
        }
    });
});
