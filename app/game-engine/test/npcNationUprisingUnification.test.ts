import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { RANK_DATA_TYPES, rankDataMetaKey } from '@sammo-ts/common';
import type { LogEntryDraft, TurnSchedule, UnitSetDefinition } from '@sammo-ts/logic';
import { DIPLOMACY_STATE, LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';
import type { InMemoryTurnWorld, TurnCalendarHandler } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { COMPACT_NPC_TEST_MAP, buildCompactNpcTestCities } from './fixtures/compactNpcTestScenario.js';
import { createTurnTestHarness } from './helpers/turnTestHarness.js';
import { NpcUnificationMemoryProfiler } from './helpers/npcUnificationMemoryProfiler.js';

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
        specialDomestic: id % 2 === 0 ? 'che_경작' : 'che_상재',
        specialWar: id % 2 === 0 ? 'che_보병' : 'che_무쌍',
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 800 },
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

const maxCityStats = (city: ReturnType<typeof buildCompactNpcTestCities>[number]) => ({
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

const boostNationOneCities = (world: InMemoryTurnWorld) => {
    const cities = world.listCities();
    for (const city of cities) {
        if (city.nationId !== 1) {
            continue;
        }
        world.updateCity(city.id, {
            population: city.populationMax,
            defence: city.defenceMax,
            wall: city.wallMax,
            meta: { ...(city.meta ?? {}), trust: 100 },
        });
    }
};

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
            chiefCount: nationGenerals.filter((general) => general.officerLevel === 12).length,
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
        diplomacy: world.listDiplomacy().map((entry) => ({
            fromNationId: entry.fromNationId,
            toNationId: entry.toNationId,
            state: entry.state,
            term: entry.term,
        })),
        citySummary,
    });
};

describe('NPC 건국/통일 장기 시뮬레이션', () => {
    it('건국, 선포, 출병, 점령과 장기 국가 감소가 안정적으로 진행되어야 한다', async () => {
        const memoryProfileEnabled = process.env.NPC_UNIFICATION_MEMORY_PROFILE === '1';
        const rankingAuditEnabled = process.env.NPC_RANKING_AUDIT === '1';
        const profileStartedAtMs = performance.now();
        const cities = buildCompactNpcTestCities().map(maxCityStats);
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
        const initialGeneralCount = rankingAuditEnabled ? 150 : 60;
        for (let i = 0; i < initialGeneralCount; i += 1) {
            const cityId = cities[i % cities.length]!.id;
            const stats =
                i % 2 === 0
                    ? { leadership: 75, strength: 75, intelligence: 10 }
                    : { leadership: 75, strength: 10, intelligence: 75 };
            generals.push(createNpcGeneral(i + 1, cityId, stats));
        }
        expect(new Set(generals.map((general) => general.role.specialDomestic))).toEqual(
            new Set(['che_경작', 'che_상재'])
        );
        expect(new Set(generals.map((general) => general.role.specialWar))).toEqual(new Set(['che_보병', 'che_무쌍']));

        const snapshot: TurnWorldSnapshot = {
            generals: generals as any,
            cities: cities as any,
            nations: [],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            map: COMPACT_NPC_TEST_MAP as any,
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
                environment: { mapName: 'compact_npc_test_map', unitSet: 'default' },
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

        let unificationLogObserved = false;
        const unificationHandler: TurnCalendarHandler = {
            onMonthChanged: () => {
                const world = worldRef.current;
                if (!world) {
                    return;
                }
                boostNationOneCities(world);
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
                unificationLogObserved = true;
            },
        };

        const lastNationAiState = new Map<number, unknown>();
        let declarationCount = 0;
        let sortieCount = 0;
        let lastResolvedAction = 'none';

        const {
            runUntil,
            reservedTurnStore,
            getCollectedLogs,
            getCollectedLogsCount,
            getCollectedLogsRange,
            getAndClearCollectedLogs,
        } = await createTurnTestHarness({
            snapshot,
            state,
            schedule,
            map: COMPACT_NPC_TEST_MAP,
            worldRef,
            extraCalendarHandlers: [unificationHandler],
            collectLogs: true,
            onActionResolved: (payload) => {
                const currentWorld = worldRef.current;
                if (currentWorld) {
                    const nationIds = new Set(currentWorld.listNations().map((nation) => nation.id));
                    const orphanCities = currentWorld
                        .listCities()
                        .filter((city) => city.nationId > 0 && !nationIds.has(city.nationId));
                    if (orphanCities.length > 0) {
                        throw new Error(
                            `orphan city ownership after ${lastResolvedAction}, before ${payload.kind}:${payload.actionKey}: ${orphanCities
                                .map((city) => `${city.id}->${city.nationId}`)
                                .join(', ')}`
                        );
                    }
                }
                lastResolvedAction = `${payload.kind}:${payload.actionKey}`;
                if (payload.kind === 'general') {
                    if (payload.actionKey === 'che_출병') {
                        sortieCount += 1;
                    }
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
        const memoryProfiler =
            memoryProfileEnabled && worldRef.current
                ? new NpcUnificationMemoryProfiler(worldRef.current, reservedTurnStore)
                : null;
        memoryProfiler?.sample('initialized');
        let lastProfileYearMonth = -1;
        const observeProfileMonth = (current: TurnWorldState) => {
            if (!memoryProfiler) {
                return;
            }
            const yearMonth = current.currentYear * 100 + current.currentMonth;
            if (yearMonth === lastProfileYearMonth) {
                return;
            }
            lastProfileYearMonth = yearMonth;
            memoryProfiler.observeTick();
            const logs = getAndClearCollectedLogs();
            if (logs.some((log) => log.text.includes('전토를 통일하였습니다.'))) {
                unificationLogObserved = true;
            }
            if (current.currentMonth === 1) {
                memoryProfiler.sample(`year-${current.currentYear}`);
            }
        };

        let monthlyLogCursor = 0;
        const maxMonthlyLogEntries = 20;
        const _dumpMonthlyLogs = (label: string) => {
            const end = getCollectedLogsCount();
            if (end <= monthlyLogCursor) {
                return;
            }
            const logs = getCollectedLogsRange(monthlyLogCursor, end);
            monthlyLogCursor = end;
            if (logs.length === 0) {
                return;
            }
            const historyLogs = logs.filter((log) => log.category === LogCategory.HISTORY);
            if (historyLogs.length === 0) {
                return;
            }
            const limitedLogs = historyLogs.slice(0, maxMonthlyLogEntries);
            const truncated = historyLogs.length - limitedLogs.length;
            console.log('[DEBUG] month history logs', {
                label,
                total: historyLogs.length,
                truncated,
                logs: limitedLogs.map((log) => log.text),
            });
        };

        try {
            await runUntil(
                (current) => current.currentYear > 182 || (current.currentYear === 182 && current.currentMonth >= 1),
                undefined,
                observeProfileMonth
            );

            const world = worldRef.current;
            if (!world) {
                throw new Error('world not initialized');
            }

            const foundedNations = world.listNations().filter((nation) => nation.level > 0);
            expect(foundedNations.length).toBeGreaterThanOrEqual(2);
            const foundedNationCount = foundedNations.length;
            const foundedGenerals = world.listGenerals().filter((general) => general.nationId > 0);
            expect(foundedGenerals.some((general) => general.role.specialDomestic !== null)).toBe(true);
            expect(foundedGenerals.some((general) => general.role.specialWar !== null)).toBe(true);
            memoryProfiler?.sample('nations-founded');

            await runUntil(
                (current) => current.currentYear > 183 || (current.currentYear === 183 && current.currentMonth >= 6),
                undefined,
                observeProfileMonth
            );
            await runUntil(
                (current) =>
                    world.listCities().every((city) => city.nationId > 0) ||
                    current.currentYear > 184 ||
                    (current.currentYear === 184 && current.currentMonth >= 6),
                undefined,
                observeProfileMonth
            );
            const neutralCities = world.listCities().filter((city) => city.nationId <= 0);
            expect(neutralCities.length).toBe(0);
            memoryProfiler?.sample('all-cities-occupied');

            const hasHighOfficer = world
                .listGenerals()
                .some((general) => general.nationId > 0 && general.officerLevel >= 12);
            expect(hasHighOfficer).toBe(true);

            if (declarationCount === 0) {
                await runUntil(
                    (current) =>
                        current.currentYear > 190 || (current.currentYear === 190 && current.currentMonth >= 1),
                    undefined,
                    observeProfileMonth
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
                            const crewed = nationGenerals.filter(
                                (general) => general.crew > 0 && general.crewTypeId > 0
                            );
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
                                    (city) => city.nationId === nation.id && city.supplyState > 0 && city.frontState > 0
                                );
                            const hasCrew = generals.some(
                                (general) => general.nationId === nation.id && general.crew > 0
                            );
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
                .filter(
                    (nation) => nation.level > 0 && world.listCities().some((city) => city.nationId === nation.id)
                ).length;
            let unifiedAt: { year: number; month: number } | null = null;

            while (true) {
                const target = addMonths(world.getState().currentYear, world.getState().currentMonth, 1);
                await runUntil(
                    (current) =>
                        current.currentYear > target.year ||
                        (current.currentYear === target.year && current.currentMonth >= target.month),
                    undefined,
                    observeProfileMonth
                );
                //_dumpMonthlyLogs(`${target.year}-${String(target.month).padStart(2, '0')}`);

                const nationIds = new Set(world.listNations().map((nation) => nation.id));
                const orphanCities = world
                    .listCities()
                    .filter((city) => city.nationId > 0 && !nationIds.has(city.nationId));
                if (orphanCities.length > 0) {
                    dumpWorldStatus(world, '존재하지 않는 국가가 도시를 소유');
                    throw new Error(
                        `orphan city ownership: ${orphanCities
                            .map((city) => `${city.id}->${city.nationId}`)
                            .join(', ')}`
                    );
                }

                const activeNationCount = world
                    .listNations()
                    .filter((nation) => nation.level > 0)
                    .filter((nation) => world.listCities().some((city) => city.nationId === nation.id)).length;
                const totalGenerals = world.listGenerals().length;

                expect(activeNationCount).toBeLessThanOrEqual(prevNationCount);
                expect(totalGenerals).toBeGreaterThanOrEqual(2);

                prevNationCount = activeNationCount;

                if (activeNationCount === 1 && !unifiedAt) {
                    const currentState = world.getState();
                    const currentMeta = currentState.meta as Record<string, unknown>;
                    // The processor intentionally stops calendar advancement after unification.
                    // Waiting for another month from this state would rerun due generals forever.
                    if ((currentMeta.isUnited ?? currentMeta.isunited ?? 0) !== 0) {
                        unifiedAt = {
                            year: currentState.currentYear,
                            month: currentState.currentMonth,
                        };
                        memoryProfiler?.sample('unified');
                        break;
                    }
                    const nextMonth = addMonths(world.getState().currentYear, world.getState().currentMonth, 1);
                    await runUntil(
                        (current) =>
                            current.currentYear > nextMonth.year ||
                            (current.currentYear === nextMonth.year && current.currentMonth >= nextMonth.month),
                        undefined,
                        observeProfileMonth
                    );
                    unifiedAt = nextMonth;
                    memoryProfiler?.sample('unified');
                    break;
                }

                if (
                    (rankingAuditEnabled && sortieCount >= 50) ||
                    world.getState().currentYear > 260 ||
                    (world.getState().currentYear === 260 && world.getState().currentMonth >= 1)
                ) {
                    break;
                }
            }

            const meta = world.getState().meta as Record<string, unknown>;
            const logs = getCollectedLogs();
            const hasUnificationLog =
                unificationLogObserved || logs.some((log) => log.text.includes('전토를 통일하였습니다.'));
            if (!rankingAuditEnabled) {
                expect(unifiedAt).not.toBeNull();
            }
            if (unifiedAt) {
                expect(meta.isUnited).toBe(2);
                expect(hasUnificationLog).toBe(true);
            } else {
                if (!rankingAuditEnabled) {
                    expect(prevNationCount).toBeLessThan(foundedNationCount);
                }
                expect(meta.isUnited ?? 0).toBe(0);
            }
            expect(sortieCount).toBeGreaterThan(0);

            if (rankingAuditEnabled) {
                const rankingAudit = RANK_DATA_TYPES.map((type) => {
                    const entries = world
                        .listGenerals()
                        .map((general) => {
                            const rawValue =
                                type === 'experience'
                                    ? general.experience
                                    : type === 'dedication'
                                      ? general.dedication
                                      : general.meta[rankDataMetaKey(type)];
                            const value = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : 0;
                            return { generalId: general.id, name: general.name, value };
                        })
                        .filter((entry) => entry.value > 0)
                        .sort((lhs, rhs) => rhs.value - lhs.value || lhs.generalId - rhs.generalId)
                        .slice(0, 10);
                    return { type, entries };
                });
                const byType = new Map(rankingAudit.map((entry) => [entry.type, entry.entries]));
                expect(byType.get('firenum')).toHaveLength(0);
                for (const type of [
                    'experience',
                    'dedication',
                    'warnum',
                    'killnum',
                    'deathnum',
                    'killcrew',
                    'deathcrew',
                    'killcrew_person',
                    'deathcrew_person',
                    'dex1',
                    'dex2',
                    'dex3',
                    'dex4',
                    'dex5',
                ] as const) {
                    expect(byType.get(type), type).toHaveLength(10);
                }
                const reportPath = resolve(
                    process.env.NPC_RANKING_AUDIT_REPORT_PATH ?? 'test-results/npc-ranking-audit.json'
                );
                mkdirSync(dirname(reportPath), { recursive: true });
                writeFileSync(
                    reportPath,
                    `${JSON.stringify(
                        {
                            year: world.getState().currentYear,
                            month: world.getState().currentMonth,
                            initialGeneralCount,
                            finalGeneralCount: world.listGenerals().length,
                            declarationCount,
                            sortieCount,
                            rankingAudit,
                        },
                        null,
                        2
                    )}\n`,
                    'utf8'
                );
                console.log(
                    `[NPC_RANKING_AUDIT]${JSON.stringify({
                        reportPath,
                        year: world.getState().currentYear,
                        month: world.getState().currentMonth,
                        declarationCount,
                        sortieCount,
                        topTenTypes: Array.from(byType.values()).filter((entries) => entries.length === 10).length,
                    })}`
                );
            }

            if (memoryProfiler) {
                expect(typeof globalThis.gc).toBe('function');
                expect(unifiedAt).not.toBeNull();
                if (!unifiedAt) {
                    throw new Error('memory profile requires actual unification');
                }
                const report = memoryProfiler.buildReport({
                    startedAtMs: profileStartedAtMs,
                    initialGeneralCount: generals.length,
                    foundedNationCount,
                    declarationCount,
                    sortieCount,
                    unifiedAt,
                    startYear: state.currentYear,
                    startMonth: state.currentMonth,
                });
                const reportPath = resolve(
                    process.env.NPC_UNIFICATION_MEMORY_REPORT_PATH ?? 'test-results/npc-unification-memory.json'
                );
                mkdirSync(dirname(reportPath), { recursive: true });
                writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
                console.log(
                    `[NPC_UNIFICATION_MEMORY_REPORT]${JSON.stringify({
                        reportPath,
                        runtime: report.runtime,
                        scenario: report.scenario,
                        result: report.result,
                        memory: report.memory,
                    })}`
                );
            }
        } catch (error) {
            const world = worldRef.current;
            if (world) {
                dumpWorldStatus(world, '테스트 실패');
            }
            throw error;
        }
    }, 360_000);
});
