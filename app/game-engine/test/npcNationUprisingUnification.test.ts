import { describe, expect, it } from 'vitest';
import type { LogEntryDraft, TurnSchedule, UnitSetDefinition } from '@sammo-ts/logic';
import { DIPLOMACY_STATE, LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';
import type { InMemoryTurnWorld, TurnCalendarHandler } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { LARGE_TEST_MAP, buildLargeTestCities } from './fixtures/largeTestMap.js';
import { createTurnTestHarness } from './helpers/turnTestHarness.js';

const mockDate = new Date('0181-08-01T00:00:00Z');

const createNpcGeneral = (
    id: number,
    cityId: number,
    stats: { leadership: number; strength: number; intelligence: number }
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

const dumpWorldStatus = (world: InMemoryTurnWorld, label: string) => {
    const state = world.getState();
    const cities = world.listCities();
    const generals = world.listGenerals();
    const nations = world.listNations();

    const nationStats = nations.map((nation) => {
        const nationCities = cities.filter((city) => city.nationId === nation.id);
        const nationGenerals = generals.filter((general) => general.nationId === nation.id);
        const totalGold = nationGenerals.reduce((sum, general) => sum + general.gold, 0);
        const totalRice = nationGenerals.reduce((sum, general) => sum + general.rice, 0);
        const avgGold = nationGenerals.length > 0 ? Math.floor(totalGold / nationGenerals.length) : 0;
        const avgRice = nationGenerals.length > 0 ? Math.floor(totalRice / nationGenerals.length) : 0;
        return {
            id: nation.id,
            name: nation.name,
            level: nation.level,
            typeCode: nation.typeCode,
            capitalCityId: nation.capitalCityId,
            cityCount: nationCities.length,
            generalCount: nationGenerals.length,
            gold: nation.gold,
            rice: nation.rice,
            avgGold,
            avgRice,
            meta: nation.meta,
        };
    });

    const citySummary = cities.map((city) => ({
        id: city.id,
        name: city.name,
        nationId: city.nationId,
        level: city.level,
        population: city.population,
        agriculture: city.agriculture,
        commerce: city.commerce,
        security: city.security,
        defence: city.defence,
        wall: city.wall,
        supplyState: city.supplyState,
        frontState: city.frontState,
    }));

    console.log('[DEBUG] world status', {
        label,
        year: state.currentYear,
        month: state.currentMonth,
        nationCount: nations.length,
        cityCount: cities.length,
        generalCount: generals.length,
        nationStats,
        citySummary,
    });
};

describe('NPC 건국/통일 장기 시뮬레이션', () => {
    it('건국, 점령 완료, 장기 감소 및 통일까지 진행되어야 한다', async () => {
        const cities = buildLargeTestCities().map(maxCityStats);
        for (const city of cities) {
            city.nationId = 0;
        }

        const unitSet: UnitSetDefinition = {
            id: 'test_unit_set',
            name: 'TestUnitSet',
            defaultCrewTypeId: 1100,
            crewTypes: [
                {
                    id: 1100,
                    armType: 1,
                    name: '보병',
                    attack: 100,
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
                {
                    id: 1400,
                    armType: 4,
                    name: '귀병',
                    attack: 80,
                    defence: 80,
                    speed: 7,
                    avoid: 5,
                    magicCoef: 0.5,
                    cost: 9,
                    rice: 9,
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
        for (let i = 0; i < 300; i += 1) {
            const cityId = cities[i % cities.length]!.id;
            const stats = i % 2 === 0
                ? { leadership: 75, strength: 75, intelligence: 10 }
                : { leadership: 75, strength: 10, intelligence: 75 };
            generals.push(createNpcGeneral(i + 1, cityId, stats));
        }

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
            currentYear: 181,
            currentMonth: 8,
            tickSeconds: 600,
            lastTurnTime: mockDate,
            meta: { seed: 1, initYear: 181, initMonth: 8 },
        };

        const schedule: TurnSchedule = {
            entries: [{ startMinute: 0, tickMinutes: 10 }],
        };

        const worldRef = { current: null as InMemoryTurnWorld | null };

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
                const citiesNow = world.listCities();
                const activeNations = world
                    .listNations()
                    .filter((nation) => nation.level > 0)
                    .filter((nation) => citiesNow.some((city) => city.nationId === nation.id));
                if (activeNations.length !== 1) {
                    return;
                }
                const winner = activeNations[0];
                const ownedCount = citiesNow.filter((city) => city.nationId === winner.id).length;
                if (ownedCount !== citiesNow.length) {
                    return;
                }
                world.updateWorldMeta({ isUnited: 2 });
                world.pushLog(buildUnificationLog(winner.name));
            },
        };

        const lastNationAiState = new Map<number, unknown>();
        let declarationCount = 0;

        const { runUntil, getCollectedLogs, getAndClearCollectedLogs } = await createTurnTestHarness({
            snapshot,
            state,
            schedule,
            map: LARGE_TEST_MAP,
            worldRef,
            extraCalendarHandlers: [unificationHandler],
            collectLogs: true,
            onActionResolved: (payload) => {
                if (payload.kind !== 'nation') {
                    return;
                }
                if (payload.nationId) {
                    lastNationAiState.set(payload.nationId, payload.aiState ?? null);
                }
                if (payload.actionKey === 'che_선전포고') {
                    declarationCount += 1;
                }
            },
        });

        const dumpMonthlyLogs = (label: string) => {
            const logs = getAndClearCollectedLogs();
            if (logs.length === 0) {
                return;
            }
            const globalLogs = logs.filter((log) => log.category === LogCategory.HISTORY);
            if (globalLogs.length === 0) {
                return;
            }
            console.log('[DEBUG] month global logs', {
                label,
                total: globalLogs.length,
                logs: globalLogs.map((log) => ({
                    category: log.category,
                    format: log.format,
                    text: log.text,
                })),
            });
        };

        try {
            await runUntil((current) =>
                current.currentYear > 182 || (current.currentYear === 182 && current.currentMonth >= 1)
            );

            const world = worldRef.current;
            if (!world) {
                throw new Error('world not initialized');
            }

            const foundedNations = world.listNations().filter((nation) => nation.level > 0);
            expect(foundedNations.length).toBeGreaterThanOrEqual(2);

            await runUntil((current) =>
                current.currentYear > 183 || (current.currentYear === 183 && current.currentMonth >= 6)
            );

            const neutralCities = world.listCities().filter((city) => city.nationId <= 0);
            expect(neutralCities.length).toBe(0);

            const hasHighOfficer = world
                .listGenerals()
                .some((general) => general.nationId > 0 && general.officerLevel >= 12);
            expect(hasHighOfficer).toBe(true);

            if (declarationCount === 0) {
                await runUntil((current) =>
                    current.currentYear > 190 || (current.currentYear === 190 && current.currentMonth >= 1)
                );
                if (declarationCount === 0) {
                    const generals = world.listGenerals().filter((general) => general.nationId > 0);
                    const yearMonth = world.getState().currentYear * 12 + world.getState().currentMonth - 1;
                    const startYear = (snapshot.scenarioMeta as { startYear?: number } | null)?.startYear ?? 180;
                    const startYearMonth = (startYear + 2) * 12 + (5 - 1);
                    const diplomacyList = world.listDiplomacy();
                    const crewSummary = world
                        .listNations()
                        .filter((nation) => nation.level > 0)
                        .map((nation) => {
                            const nationGenerals = generals.filter((general) => general.nationId === nation.id);
                            const crewed = nationGenerals.filter((general) => general.crew > 0 && general.crewTypeId > 0);
                            return {
                                nationId: nation.id,
                                totalGenerals: nationGenerals.length,
                                crewedGenerals: crewed.length,
                                maxCrew: crewed.reduce((max, general) => Math.max(max, general.crew), 0),
                            };
                        });
                    const dipTrace = world
                        .listNations()
                        .filter((nation) => nation.level > 0)
                        .map((nation) => {
                            const warTargets = diplomacyList.filter(
                                (entry) =>
                                    entry.fromNationId === nation.id &&
                                    (entry.state === DIPLOMACY_STATE.WAR || entry.state === DIPLOMACY_STATE.DECLARATION)
                            );
                            const declareTerms = warTargets
                                .filter((entry) => entry.state === DIPLOMACY_STATE.DECLARATION)
                                .map((entry) => entry.term);
                            const minWarTerm = declareTerms.length > 0 ? Math.min(...declareTerms) : null;
                            const frontStatus = world
                                .listCities()
                                .some(
                                    (city) =>
                                        city.nationId === nation.id && city.supplyState > 0 && city.frontState > 0
                                );
                            const hasCrew = generals.some((general) => general.nationId === nation.id && general.crew > 0);
                            const meta = (nation.meta ?? {}) as Record<string, unknown>;
                            const lastAttackable = typeof meta.last_attackable === 'number' ? meta.last_attackable : 0;
                            return {
                                nationId: nation.id,
                                yearMonth,
                                startYearMonth,
                                warTargets: warTargets.length,
                                minWarTerm,
                                frontStatus,
                                hasCrew,
                                lastAttackable,
                            };
                        });
                    const diplomacyPairs = world
                        .listDiplomacy()
                        .filter((entry) => entry.fromNationId !== entry.toNationId)
                        .map((entry) => ({
                            from: entry.fromNationId,
                            to: entry.toNationId,
                            state: entry.state,
                            term: entry.term,
                        }));

                    console.log('[DEBUG] no declaration by 190-01', {
                        nations: world.listNations().map((nation) => ({
                            id: nation.id,
                            name: nation.name,
                            level: nation.level,
                            capitalCityId: nation.capitalCityId,
                            meta: nation.meta,
                        })),
                        crewSummary,
                        dipTrace,
                        diplomacyPairs,
                        lastNationAiState: Array.from(lastNationAiState.entries()).map(([nationId, aiState]) => {
                            const record = (aiState ?? {}) as Record<string, unknown>;
                            return {
                                nationId,
                                dipState: record.dipState,
                                attackable: record.attackable,
                                frontCities: record.frontCities,
                                warTargetNation: record.warTargetNation,
                                year: record.year,
                                month: record.month,
                            };
                        }),
                    });
                    throw new Error('no declaration by 190-01');
                }
            }

            let prevNationCount = world
                .listNations()
                .filter((nation) => nation.level > 0 && world.listCities().some((city) => city.nationId === nation.id))
                .length;
            let unifiedAt: { year: number; month: number } | null = null;

            while (true) {
                const target = addMonths(world.getState().currentYear, world.getState().currentMonth, 1);
                await runUntil((current) =>
                    current.currentYear > target.year ||
                    (current.currentYear === target.year && current.currentMonth >= target.month)
                );
                dumpMonthlyLogs(`${target.year}-${String(target.month).padStart(2, '0')}`);

                const activeNationCount = world
                    .listNations()
                    .filter((nation) => nation.level > 0)
                    .filter((nation) => world.listCities().some((city) => city.nationId === nation.id)).length;
                const totalGenerals = world.listGenerals().length;

                expect(activeNationCount).toBeLessThanOrEqual(prevNationCount);
                expect(totalGenerals).toBeGreaterThanOrEqual(2);

                prevNationCount = activeNationCount;

                if (activeNationCount === 1 && !unifiedAt) {
                    const nextMonth = addMonths(world.getState().currentYear, world.getState().currentMonth, 1);
                    await runUntil((current) =>
                        current.currentYear > nextMonth.year ||
                        (current.currentYear === nextMonth.year && current.currentMonth >= nextMonth.month)
                    );
                    unifiedAt = nextMonth;
                    break;
                }

                if (
                    world.getState().currentYear > 300 ||
                    (world.getState().currentYear === 300 && world.getState().currentMonth >= 1)
                ) {
                    break;
                }
            }

            const meta = world.getState().meta as Record<string, unknown>;
            if (!unifiedAt) {
                dumpWorldStatus(world, '통일 실패');
                throw new Error('unification did not occur before 300-01');
            }
            expect(meta.isUnited).toBe(2);

            const logs = getCollectedLogs();
            const hasUnificationLog = logs.some((log) => log.text.includes('전토를 통일하였습니다.'));
            expect(hasUnificationLog).toBe(true);

            const warStates = world.listDiplomacy().filter((entry) => entry.state === DIPLOMACY_STATE.WAR);
            if (warStates.length > 0) {
                expect(warStates.length).toBeGreaterThan(0);
            }
        } catch (error) {
            const world = worldRef.current;
            if (world) {
                dumpWorldStatus(world, '테스트 실패');
            }
            throw error;
        }
    }, 90000);
});
