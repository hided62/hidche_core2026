import { describe, expect, it } from 'vitest';
import type { TurnSchedule, UnitSetDefinition } from '@sammo-ts/logic';
import { DIPLOMACY_STATE } from '@sammo-ts/logic';
import type { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { LARGE_TEST_MAP, buildLargeTestCities } from './fixtures/largeTestMap.js';
import { createTurnTestHarness } from './helpers/turnTestHarness.js';

const mockDate = new Date('0185-01-01T00:00:00Z');

const createNpcGeneral = (
    id: number,
    cityId: number,
    nationId: number,
    officerLevel: number,
    stats: { leadership: number; strength: number; intelligence: number },
    overrides: Partial<TurnGeneral> = {}
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
    meta: { killturn: 800 },
    officerLevel,
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
    ...overrides,
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

const weakCityStats = (city: ReturnType<typeof buildLargeTestCities>[number]) => ({
    ...city,
    population: 1000,
    agriculture: 1,
    commerce: 1,
    security: 1,
    defence: 1,
    wall: 1,
    supplyState: 1,
    frontState: 1,
    meta: { ...(city.meta ?? {}), trust: 5, trade: 0 },
});

describe('도시 점령 시 국가 멸망 처리', () => {
    it('마지막 도시를 점령하면 약소국이 삭제되어야 한다', async () => {
        const cities = buildLargeTestCities().map(maxCityStats);
        const weakCityId = 1;
        const strongFrontCityId = 2;

        for (const city of cities) {
            city.nationId = 1;
        }
        const weakCity = cities.find((city) => city.id === weakCityId)!;
        weakCity.nationId = 2;
        Object.assign(weakCity, weakCityStats(weakCity));

        const strongFrontCity = cities.find((city) => city.id === strongFrontCityId)!;
        strongFrontCity.frontState = 1;
        strongFrontCity.supplyState = 1;

        const unitSet: UnitSetDefinition = {
            id: 'test_unit_set',
            name: 'TestUnitSet',
            defaultCrewTypeId: 1100,
            crewTypes: [
                {
                    id: 1100,
                    armType: 1,
                    name: '보병',
                    attack: 150,
                    defence: 150,
                    speed: 7,
                    avoid: 10,
                    magicCoef: 0,
                    cost: 10,
                    rice: 10,
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

        const delayedTurnTime = new Date(mockDate.getTime() + 60 * 60 * 1000);

        const strongLeader = createNpcGeneral(
            1,
            strongFrontCityId,
            1,
            12,
            { leadership: 90, strength: 90, intelligence: 70 },
            {
                crew: 9000,
                crewTypeId: 1100,
                train: 100,
                atmos: 100,
                gold: 500000,
                rice: 500000,
            }
        );
        const generals: TurnGeneral[] = [strongLeader];
        for (let i = 2; i <= 6; i += 1) {
            generals.push(
                createNpcGeneral(i, strongFrontCityId, 1, 2, { leadership: 80, strength: 80, intelligence: 50 }, {
                    crew: 8000,
                    crewTypeId: 1100,
                    train: 100,
                    atmos: 100,
                    gold: 100000,
                    rice: 100000,
                    turnTime: delayedTurnTime,
                })
            );
        }
        const weakGeneral = createNpcGeneral(
            100,
            weakCityId,
            2,
            12,
            { leadership: 10, strength: 10, intelligence: 10 },
            {
                crew: 0,
                crewTypeId: 1100,
                train: 0,
                atmos: 0,
                gold: 0,
                rice: 0,
                turnTime: delayedTurnTime,
            }
        );
        generals.push(weakGeneral);

        const snapshot: TurnWorldSnapshot = {
            generals: generals as any,
            cities: cities as any,
            nations: [
                {
                    id: 1,
                    name: '강국',
                    color: '#AA0000',
                    capitalCityId: strongFrontCityId,
                    chiefGeneralId: 1,
                    gold: 800000,
                    rice: 800000,
                    power: 10000,
                    level: 1,
                    typeCode: 'npc',
                    meta: { tech: 10 },
                },
                {
                    id: 2,
                    name: '약소국',
                    color: '#0000AA',
                    capitalCityId: weakCityId,
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
                { fromNationId: 1, toNationId: 2, state: DIPLOMACY_STATE.WAR, term: 12, dead: 0, meta: {} },
                { fromNationId: 2, toNationId: 1, state: DIPLOMACY_STATE.WAR, term: 12, dead: 0, meta: {} },
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
            currentYear: 185,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: mockDate,
            meta: { seed: 1, initYear: 185, initMonth: 1 },
        };

        const schedule: TurnSchedule = {
            entries: [{ startMinute: 0, tickMinutes: 10 }],
        };

        const worldRef = { current: null as InMemoryTurnWorld | null };
        const { world, reservedTurnStore, runOneTick } = await createTurnTestHarness({
            snapshot,
            state,
            schedule,
            map: LARGE_TEST_MAP,
            worldRef,
        });

        const turns = reservedTurnStore.getGeneralTurns(strongLeader.id);
        turns[0] = {
            action: 'che_출병',
            args: { destCityId: weakCityId },
        };

        await runOneTick();

        expect(world.getCityById(weakCityId)?.nationId).toBe(1);
        expect(world.getNationById(2)).toBeNull();
        expect(world.listNations().some((nation) => nation.id === 2)).toBe(false);

        const updatedWeakGeneral = world.getGeneralById(weakGeneral.id);
        expect(updatedWeakGeneral?.nationId).toBe(0);
        expect(updatedWeakGeneral?.officerLevel).toBe(0);
    });
});
