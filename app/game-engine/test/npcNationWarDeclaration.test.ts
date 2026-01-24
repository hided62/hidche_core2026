import { describe, expect, it } from 'vitest';
import type { LogEntryDraft, TurnSchedule, UnitSetDefinition } from '@sammo-ts/logic';
import { DIPLOMACY_STATE, LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';
import type { InMemoryTurnWorld, TurnCalendarHandler } from '../src/turn/inMemoryWorld.js';
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
    crewTypeId: 1100,
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

const addMonths = (year: number, month: number, delta: number): { year: number; month: number } => {
    const total = year * 12 + (month - 1) + delta;
    const nextYear = Math.floor(total / 12);
    const nextMonth = (total % 12) + 1;
    return { year: nextYear, month: nextMonth };
};

const buildUnificationLog = (nationName: string): LogEntryDraft => ({
    scope: LogScope.SYSTEM,
    category: LogCategory.HISTORY,
    format: LogFormat.YEAR_MONTH,
    text: `<C>●</><Y><b>【통일】</b></><D><b>${nationName}</b></>이 전토를 통일하였습니다.`,
    meta: {},
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
        for (let i = 0; i < 3; i += 1) {
            pushNationGenerals(2, cityB1.id);
        }

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
        const dispatchCounts = new Map<string, number>();

        const unificationHandler: TurnCalendarHandler = {
            onMonthChanged: () => {
                const world = worldRef.current;
                if (!world) {
                    return;
                }
                const meta = world.getState().meta as Record<string, unknown>;
                if (typeof meta.isUnited === 'number' && meta.isUnited !== 0) {
                    return;
                }
                const cities = world.listCities();
                const activeNations = world
                    .listNations()
                    .filter((nation) => nation.level > 0)
                    .filter((nation) => cities.some((city) => city.nationId === nation.id));
                if (activeNations.length !== 1) {
                    return;
                }
                const winner = activeNations[0];
                const ownedCount = cities.filter((city) => city.nationId === winner.id).length;
                if (ownedCount !== cities.length) {
                    return;
                }
                world.updateWorldMeta({ isUnited: 2 });
                world.pushLog(buildUnificationLog(winner.name));
            },
        };

        const { runUntil, getCollectedLogs } = await createTurnTestHarness({
            snapshot,
            state,
            schedule,
            map: LARGE_TEST_MAP,
            worldRef,
            extraCalendarHandlers: [unificationHandler],
            collectLogs: true,
            onActionResolved: (payload) => {
                if (payload.kind === 'general' && payload.actionKey === 'che_출병') {
                    const world = worldRef.current;
                    if (!world) {
                        return;
                    }
                    const { currentYear, currentMonth } = world.getState();
                    const key = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
                    dispatchCounts.set(key, (dispatchCounts.get(key) ?? 0) + 1);
                }
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

        const findDiplomacyEntry = (world: InMemoryTurnWorld | null) => {
            const diplomacyEntries = world?.listDiplomacy() ?? [];
            return diplomacyEntries.find((entry) =>
                (entry.fromNationId === 1 && entry.toNationId === 2) ||
                (entry.fromNationId === 2 && entry.toNationId === 1)
            );
        };

        const countCities = (nationId: number, currentWorld: InMemoryTurnWorld) =>
            currentWorld.listCities().filter((city) => city.nationId === nationId).length;

        try {
            await runUntil(
                (current) =>
                    declaredAt !== null ||
                    current.currentYear > 183 ||
                    (current.currentYear === 183 && current.currentMonth >= 8)
            );
        } catch (error) {
            debug.dumpWatched('선전포고 테스트 실패');
            throw error;
        }

        if (!declaredAt) {
            debug.dumpWatched('선전포고 미발생');
        }

        expect(declaredAt).not.toBeNull();

        const world = worldRef.current;
        if (!world) {
            debug.dumpWatched('선전포고 후 월드 누락');
            throw new Error('world not initialized');
        }

        const declareEntry = findDiplomacyEntry(world);
        if (!declareEntry) {
            debug.dumpWatched('선전포고 외교 상태 누락');
        }
        expect(declareEntry).not.toBeNull();
        expect(declareEntry?.state).toBe(DIPLOMACY_STATE.DECLARATION);

        const remainTurns = Math.max(0, (declareEntry?.term ?? 0) - 1);
        const preWarTarget = addMonths(
            world!.getState().currentYear,
            world!.getState().currentMonth,
            remainTurns
        );

        await runUntil((current) =>
            current.currentYear > preWarTarget.year ||
            (current.currentYear === preWarTarget.year && current.currentMonth >= preWarTarget.month)
        );

        const preWarEntry = findDiplomacyEntry(world);
        if (!preWarEntry) {
            debug.dumpWatched('개전 직전 외교 상태 누락');
        }
        expect(preWarEntry).not.toBeNull();
        expect(preWarEntry?.state).toBe(DIPLOMACY_STATE.DECLARATION);
        expect(preWarEntry?.term).toBe(1);

        const recruited = world
            .listGenerals()
            .filter((general) => general.nationId > 0 && general.crew > 0 && general.crewTypeId > 0);

        if (recruited.length === 0) {
            debug.dumpWatched('개전 직전 병력 부족');
        }
        expect(recruited.length).toBeGreaterThanOrEqual(5);
        for (const general of recruited) {
            expect(general.train).toBeGreaterThanOrEqual(90);
            expect(general.atmos).toBeGreaterThanOrEqual(90);
            const city = world.getCityById(general.cityId);
            if (!city || city.frontState <= 0) {
                debug.dumpWatched('접경 도시 배치 실패');
            }
            expect(city).not.toBeNull();
            expect(city?.frontState ?? 0).toBeGreaterThan(0);
        }

        const warTarget = addMonths(preWarTarget.year, preWarTarget.month, 1);
        await runUntil((current) =>
            current.currentYear > warTarget.year ||
            (current.currentYear === warTarget.year && current.currentMonth >= warTarget.month)
        );

        const warEntry = findDiplomacyEntry(world);
        if (!warEntry) {
            debug.dumpWatched('개전 외교 상태 누락');
        }
        expect(warEntry).not.toBeNull();
        expect(warEntry?.state).toBe(DIPLOMACY_STATE.WAR);

        let prevNation1Cities = countCities(1, world);
        let prevNation2Cities = countCities(2, world);
        let guard = 0;

        while (prevNation1Cities > 0 && guard < 120) {
            const next = addMonths(world.getState().currentYear, world.getState().currentMonth, 1);
            await runUntil((current) =>
                current.currentYear > next.year ||
                (current.currentYear === next.year && current.currentMonth >= next.month)
            );

            const warLoopEntry = findDiplomacyEntry(world);
            if (!warLoopEntry) {
                debug.dumpWatched('개전 이후 외교 상태 누락');
                throw new Error('missing diplomacy entry');
            }
            expect(warLoopEntry.state).toBe(DIPLOMACY_STATE.WAR);

            const nowNation1Cities = countCities(1, world);
            const nowNation2Cities = countCities(2, world);

            expect(nowNation1Cities).toBeLessThanOrEqual(prevNation1Cities);
            expect(nowNation2Cities).toBeGreaterThanOrEqual(prevNation2Cities);

            prevNation1Cities = nowNation1Cities;
            prevNation2Cities = nowNation2Cities;
            guard += 1;
        }

        if (prevNation1Cities > 0) {
            debug.dumpWatched('국가 1 도시 소멸 실패');
            throw new Error('nation 1 cities not eliminated');
        }

        const allOwnedByNation2 = world.listCities().every((city) => city.nationId === 2);
        expect(allOwnedByNation2).toBe(true);

        const unifyCheckTarget = addMonths(world.getState().currentYear, world.getState().currentMonth, 1);
        await runUntil((current) =>
            current.currentYear > unifyCheckTarget.year ||
            (current.currentYear === unifyCheckTarget.year && current.currentMonth >= unifyCheckTarget.month)
        );

        const worldMeta = world.getState().meta as Record<string, unknown>;
        if (worldMeta.isUnited !== 2) {
            debug.dumpWatched('통일 상태 누락');
        }
        expect(worldMeta.isUnited).toBe(2);

        const logs = getCollectedLogs();
        const hasUnificationLog = logs.some((log) => log.text.includes('전토를 통일하였습니다.'));
        if (!hasUnificationLog) {
            debug.dumpWatched('통일 로그 누락');
        }
        expect(hasUnificationLog).toBe(true);

        const dispatchWindowEnd = addMonths(warTarget.year, warTarget.month, 2);
        await runUntil((current) =>
            current.currentYear > dispatchWindowEnd.year ||
            (current.currentYear === dispatchWindowEnd.year && current.currentMonth >= dispatchWindowEnd.month)
        );

        const dispatchKeys: string[] = [];
        for (let offset = 0; offset <= 2; offset += 1) {
            const target = addMonths(warTarget.year, warTarget.month, offset);
            dispatchKeys.push(`${target.year}-${String(target.month).padStart(2, '0')}`);
        }
        const dispatchCount = dispatchKeys.reduce((sum, key) => sum + (dispatchCounts.get(key) ?? 0), 0);
        if (dispatchCount <= 0) {
            debug.dumpWatched('출병 기록 누락');
        }
        expect(dispatchCount).toBeGreaterThan(0);
    });
});
