import { describe, expect, it } from 'vitest';
import type { TurnSchedule, UnitSetDefinition } from '@sammo-ts/logic';
import type { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { LARGE_TEST_MAP, buildLargeTestCities } from './fixtures/largeTestMap.js';
import { createTurnTestHarness, createWorldDebugger } from './helpers/turnTestHarness.js';

const mockDate = new Date('0183-05-01T00:00:00Z');

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
    gold: 20000,
    rice: 20000,
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

describe('NPC 선전포고 조건 테스트', () => {
    it('183년 5월 시작 후 3개월 이내 선전포고가 발생해야 한다', async () => {
        const cities = buildLargeTestCities().map(maxCityStats);
        const cityA1 = cities.find((city) => city.id === 1)!;
        const cityA2 = cities.find((city) => city.id === 2)!;
        const cityB1 = cities.find((city) => city.id === 3)!;
        const cityB2 = cities.find((city) => city.id === 5)!;

        cityA1.nationId = 1;
        cityA2.nationId = 1;
        cityB1.nationId = 2;
        cityB2.nationId = 2;

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
        let nextId = 1;
        const pushNationGenerals = (nationId: number, cityId: number) => {
            generals.push(createNpcGeneral(nextId++, cityId, nationId, 12, {
                leadership: 90,
                strength: 80,
                intelligence: 40,
            }));
            for (let i = 0; i < 9; i += 1) {
                generals.push(createNpcGeneral(nextId++, cityId, nationId, 2, {
                    leadership: 70,
                    strength: 80,
                    intelligence: 30,
                }));
            }
            for (let i = 0; i < 10; i += 1) {
                generals.push(createNpcGeneral(nextId++, cityId, nationId, 2, {
                    leadership: 70,
                    strength: 30,
                    intelligence: 80,
                }));
            }
        };
        pushNationGenerals(1, cityA1.id);
        pushNationGenerals(2, cityB1.id);

        const snapshot: TurnWorldSnapshot = {
            generals: generals as any,
            cities: cities as any,
            nations: [
                {
                    id: 1,
                    name: 'NPC_A',
                    color: '#AA0000',
                    capitalCityId: cityA1.id,
                    chiefGeneralId: 1,
                    gold: 1000000,
                    rice: 1000000,
                    power: 0,
                    level: 1,
                    typeCode: 'npc',
                    meta: { tech: 0 },
                },
                {
                    id: 2,
                    name: 'NPC_B',
                    color: '#0000AA',
                    capitalCityId: cityB1.id,
                    chiefGeneralId: 21,
                    gold: 1000000,
                    rice: 1000000,
                    power: 0,
                    level: 1,
                    typeCode: 'npc',
                    meta: { tech: 0 },
                },
            ],
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
                    minAvailableRecruitPop: 0,
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
            currentYear: 183,
            currentMonth: 5,
            tickSeconds: 600,
            lastTurnTime: mockDate,
            meta: { seed: 1, initYear: 183, initMonth: 5 },
        };

        const schedule: TurnSchedule = {
            entries: [{ startMinute: 0, tickMinutes: 10 }],
        };

        const worldRef = { current: null as InMemoryTurnWorld | null };
        let declaredAt: { year: number; month: number; nationId: number } | null = null;

        const { runUntil } = await createTurnTestHarness({
            snapshot,
            state,
            schedule,
            map: LARGE_TEST_MAP,
            worldRef,
            onActionResolved: (payload) => {
                if (payload.kind !== 'nation') {
                    return;
                }
                if (payload.actionKey !== 'che_선전포고') {
                    return;
                }
                const world = worldRef.current;
                if (!world || declaredAt) {
                    return;
                }
                const { currentYear, currentMonth } = world.getState();
                declaredAt = { year: currentYear, month: currentMonth, nationId: payload.nationId ?? 0 };
            },
        });

        const debug = createWorldDebugger(() => worldRef.current, {
            nationIds: [1, 2],
            cityIds: [cityA1.id, cityA2.id, cityB1.id, cityB2.id],
            includeNationSummary: true,
        });

        try {
            await runUntil(
                (current) => current.currentYear > 183 || (current.currentYear === 183 && current.currentMonth >= 8)
            );
        } catch (error) {
            debug.dumpWatched('선전포고 테스트 실패');
            throw error;
        }

        if (!declaredAt) {
            debug.dumpWatched('선전포고 미발생');
        }

        expect(declaredAt).not.toBeNull();
    });
});
