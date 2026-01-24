import { describe, expect, it, vi } from 'vitest';
import type {
    ConstraintContext,
    LogEntryDraft,
    RequirementKey,
    StateView,
    TurnSchedule,
    UnitSetDefinition,
} from '@sammo-ts/logic';
import { DEFAULT_TURN_COMMAND_PROFILE, LogCategory, evaluateConstraints } from '@sammo-ts/logic';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import type { GeneralAiDebugState } from '../src/turn/ai/generalAi.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { createReservedTurnHandler } from '../src/turn/reservedTurnHandler.js';
import { InMemoryTurnProcessor } from '../src/turn/inMemoryTurnProcessor.js';
import { GeneralAI } from '../src/turn/ai/generalAi.js';
import { do징병 } from '../src/turn/ai/generalAiGeneralActions.js';
import { createIncomeHandler } from '../src/turn/incomeHandler.js';
import { createNpcTaxHandler } from '../src/turn/npcTaxHandler.js';
import { createFrontStateHandler } from '../src/turn/frontStateHandler.js';
import { composeCalendarHandlers } from '../src/turn/calendarHandlers.js';
import { buildCommandEnv, buildReservedTurnDefinitions } from '../src/turn/reservedTurnCommands.js';
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
                    2
                )
            );
        }

        const cities = buildLargeTestCities();
        const initialCityStats = new Map(
            cities.map((city) => [
                city.id,
                {
                    population: city.population,
                    agriculture: city.agriculture,
                    commerce: city.commerce,
                    security: city.security,
                    defence: city.defence,
                    wall: city.wall,
                },
            ])
        );

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
            currentYear: 179,
            currentMonth: 8,
            tickSeconds: 600,
            lastTurnTime: mockDate,
            meta: { seed: 1, initYear: 179, initMonth: 8 },
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

        type TurnTrace = {
            year: number;
            month: number;
            generalId: number;
            actionText: string;
            actionKey: string;
            requestedAction: string;
            usedFallback: boolean;
            blockedReason?: string;
            ok: boolean;
            error?: unknown;
            logs: LogEntryDraft[];
            aiState?: GeneralAiDebugState;
        };

        const turnTraces: TurnTrace[] = [];
        const traceByGeneralId = new Map<number, TurnTrace>();

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
                const trace = traceByGeneralId.get(payload.generalId);
                if (!trace) {
                    return;
                }
                trace.actionKey = payload.actionKey;
                trace.requestedAction = payload.requestedAction;
                trace.usedFallback = payload.usedFallback;
                trace.blockedReason = payload.blockedReason;
                trace.aiState = payload.aiState;
            },
        });

        const tracedHandler = {
            execute: (ctx: Parameters<typeof handler.execute>[0]) => {
                const trace: TurnTrace = {
                    year: ctx.world.currentYear,
                    month: ctx.world.currentMonth,
                    generalId: ctx.general.id,
                    actionKey: 'unknown',
                    requestedAction: 'unknown',
                    usedFallback: false,
                    ok: true,
                    actionText: 'unknown',
                    logs: [],
                };
                traceByGeneralId.set(ctx.general.id, trace);
                const result = handler.execute(ctx);
                const actionLog = result.logs?.find((log) => log.category === LogCategory.ACTION);
                trace.actionText = actionLog?.text ?? 'unknown';
                trace.logs = result.logs ?? [];
                turnTraces.push(trace);
                return result;
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
            afterExecuteGeneral: async (general, result) => {
                const trace = traceByGeneralId.get(general.id);
                if (!trace) {
                    return;
                }
                trace.ok = result.ok;
                trace.error = result.error;
            },
        });
        const checkpointGoldByGeneral = new Map<number, number>();

        const dumpTraceSummary = (title: string, limit = 50) => {
            const recent = turnTraces.slice(-limit);
            console.log(`\n[TRACE] ${title} (last ${recent.length})`);
            for (const trace of recent) {
                const action = trace.actionText.replace(/\s+/g, ' ').trim();
                const extra = trace.usedFallback
                    ? ` fallback(${trace.requestedAction} -> ${trace.actionKey}) ${trace.blockedReason ?? ''}`
                    : ` ${trace.requestedAction} -> ${trace.actionKey}`;
                console.log(
                    `- ${trace.year}-${String(trace.month).padStart(2, '0')} G${trace.generalId} ` +
                        `${trace.ok ? 'OK' : 'FAIL'} ${action}${extra}`
                );
            }
        };

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
                expect(nationGenerals.length).toBeGreaterThanOrEqual(targetCount);
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

        const assertWarReadiness = (minCount: number, minTrain = 70, minAtmos = 70) => {
            const recruited = world
                .listGenerals()
                .filter((general) => general.nationId > 0 && general.crew > 0 && general.crewTypeId > 0);
            const ready = recruited.filter((general) => general.train >= minTrain && general.atmos >= minAtmos);
            expect(ready.length).toBeGreaterThanOrEqual(minCount);
        };

        const assertDispatchRecorded = (year: number, month: number, minCount = 1) => {
            const matches = turnTraces.filter(
                (trace) => trace.year === year && trace.month === month && trace.actionKey === 'che_출병'
            );
            expect(matches.length).toBeGreaterThanOrEqual(minCount);
        };

        const assertNoNeutralCities = () => {
            const neutralCities = world.listCities().filter((city) => city.nationId <= 0);
            expect(neutralCities.length).toBe(0);
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

        const assertDomesticGrowthBy = (year: number, month: number) => {
            const citiesNow = world.listCities().filter((city) => city.nationId > 0);
            for (const city of citiesNow) {
                const baseline = initialCityStats.get(city.id);
                if (!baseline) {
                    continue;
                }
                const delta = {
                    population: city.population - baseline.population,
                    agriculture: city.agriculture - baseline.agriculture,
                    commerce: city.commerce - baseline.commerce,
                    security: city.security - baseline.security,
                    defence: city.defence - baseline.defence,
                    wall: city.wall - baseline.wall,
                };
                console.log('[DEBUG] domestic delta', {
                    year,
                    month,
                    cityId: city.id,
                    nationId: city.nationId,
                    delta,
                });

                const failures: string[] = [];
                if (city.population <= baseline.population) failures.push('population');
                if (city.agriculture <= baseline.agriculture) failures.push('agriculture');
                if (city.commerce <= baseline.commerce) failures.push('commerce');
                if (city.security <= baseline.security) failures.push('security');
                if (city.defence <= baseline.defence) failures.push('defence');
                if (city.wall <= baseline.wall) failures.push('wall');
                if (failures.length > 0) {
                    console.log('[DEBUG] domestic not grown', {
                        year,
                        month,
                        cityId: city.id,
                        nationId: city.nationId,
                        failures,
                        baseline,
                        current: {
                            population: city.population,
                            agriculture: city.agriculture,
                            commerce: city.commerce,
                            security: city.security,
                            defence: city.defence,
                            wall: city.wall,
                        },
                    });
                }
                expect(city.population).toBeGreaterThan(baseline.population);
                expect(city.agriculture).toBeGreaterThan(baseline.agriculture);
                expect(city.commerce).toBeGreaterThan(baseline.commerce);
                expect(city.security).toBeGreaterThan(baseline.security);
                expect(city.defence).toBeGreaterThan(baseline.defence);
                expect(city.wall).toBeGreaterThan(baseline.wall);
            }
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
            ['182-01', () => assertDomesticGrowthBy(182, 1)],
            ['182-10', () => assertNationRecruitCount(5)],
            ['182-12', () => assertWarReadiness(10, 70, 70)],
            ['183-01', () => assertDispatchRecorded(183, 1, 1)],
            ['183-07', () => assertNoNeutralCities()],
        ]);

        const toKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

        const debugRecruitConstraints = async (generalId: number) => {
            const general = world.getGeneralById(generalId);
            if (!general) {
                console.log('[DEBUG] no general for recruit check', generalId);
                return;
            }
            const city = world.getCityById(general.cityId);
            const nation = general.nationId > 0 ? world.getNationById(general.nationId) : null;
            const env = buildCommandEnv(snapshot.scenarioConfig, snapshot.unitSet);
            const { general: generalDefinitions, nation: nationDefinitions } = await buildReservedTurnDefinitions({
                env,
                commandProfile: DEFAULT_TURN_COMMAND_PROFILE,
                defaultActionKey: '휴식',
            });
            const definition = generalDefinitions.get('che_징병');
            if (!definition) {
                console.log('[DEBUG] no che_징병 definition');
                return;
            }
            const args = {
                crewType: snapshot.unitSet?.defaultCrewTypeId ?? 1100,
                amount: general.stats.leadership * 100,
            };
            const parsedArgs = definition.parseArgs(args);
            if (!parsedArgs) {
                console.log('[DEBUG] che_징병 args invalid', args);
                return;
            }

            const state = world.getState();
            const startYear = snapshot.scenarioMeta?.startYear ?? 0;
            const constraintEnv: Record<string, unknown> = {
                currentYear: state.currentYear,
                currentMonth: state.currentMonth,
                year: state.currentYear,
                month: state.currentMonth,
                startYear,
                relYear: state.currentYear - startYear,
                openingPartYear: env.openingPartYear,
                minAvailableRecruitPop: env.minAvailableRecruitPop,
                cities: world.listCities(),
                nations: world.listNations(),
                map: LARGE_TEST_MAP,
                unitSet: snapshot.unitSet,
            };

            const ctx: ConstraintContext = {
                actorId: general.id,
                cityId: general.cityId,
                nationId: general.nationId,
                args: parsedArgs as Record<string, unknown>,
                env: constraintEnv,
                mode: 'full',
            };

            const view: StateView = {
                has: (req: RequirementKey) => {
                    if (req.kind === 'general') return world.getGeneralById(req.id) !== null;
                    if (req.kind === 'city') return world.getCityById(req.id) !== null;
                    if (req.kind === 'nation') return world.getNationById(req.id) !== null;
                    if (req.kind === 'generalList') return true;
                    if (req.kind === 'nationList') return true;
                    if (req.kind === 'env') return true;
                    return false;
                },
                get: (req: RequirementKey) => {
                    if (req.kind === 'general') return world.getGeneralById(req.id);
                    if (req.kind === 'city') return world.getCityById(req.id);
                    if (req.kind === 'nation') return world.getNationById(req.id);
                    if (req.kind === 'generalList') return world.listGenerals();
                    if (req.kind === 'nationList') return world.listNations();
                    if (req.kind === 'env') return constraintEnv[req.key] ?? null;
                    return null;
                },
            };

            const constraints = definition.buildConstraints(ctx, parsedArgs as never);
            const result = evaluateConstraints(constraints, ctx, view);
            console.log('[DEBUG] che_징병 constraint result:', result);
            for (const constraint of constraints) {
                const single = evaluateConstraints([constraint], ctx, view);
                if (single.kind !== 'allow') {
                    console.log('[DEBUG] constraint blocked:', constraint.name, single);
                }
            }

            const generalFallback = generalDefinitions.get('휴식')!;
            const nationFallback = nationDefinitions.get('휴식')!;
            const ai = new GeneralAI({
                general,
                city: city ?? undefined,
                nation,
                world: state,
                worldRef: world,
                reservedTurnProvider: reservedTurnStore,
                scenarioConfig: snapshot.scenarioConfig,
                scenarioMeta: snapshot.scenarioMeta,
                map: LARGE_TEST_MAP,
                unitSet: snapshot.unitSet,
                commandEnv: env,
                generalDefinitions,
                nationDefinitions,
                generalFallback,
                nationFallback,
            });
            console.log('[DEBUG] can 징병:', ai.generalPolicy.can('징병'));
            console.log('[DEBUG] priority includes 징병:', ai.generalPolicy.priority.includes('징병'));
            console.log('[DEBUG] do징병 candidate:', do징병(ai));
        };

        try {
            while (true) {
                await runOneMonth();
                const { currentYear, currentMonth } = world.getState();
                const key = toKey(currentYear, currentMonth);
                const checker = targetChecks.get(key);
                if (checker) {
                    checker();
                }
                if (currentYear > 183 || (currentYear === 183 && currentMonth >= 7)) {
                    break;
                }
            }
        } catch (error) {
            const lastAiTrace = [...turnTraces].reverse().find((trace) => trace.aiState);
            if (lastAiTrace?.aiState) {
                console.log('[DEBUG] last aiState:', lastAiTrace.aiState);
            }
            const debugGeneralId = lastAiTrace?.generalId ?? world.listGenerals()[0]?.id;
            if (debugGeneralId) {
                await debugRecruitConstraints(debugGeneralId);
            }
            dumpTraceSummary('NPC 대형 시뮬레이션 실패');
            const sampleNation = world.listNations().find((nation) => nation.level >= 1 && nation.capitalCityId);
            if (sampleNation) {
                const policy = (sampleNation.meta as Record<string, unknown>)?.npc_nation_policy;
                console.log('[TRACE] sample npc_nation_policy:', policy);
                const sampleGeneral = world
                    .listGenerals()
                    .find((general) => general.nationId === sampleNation.id && general.cityId > 0);
                if (sampleGeneral) {
                    const city = world.getCityById(sampleGeneral.cityId);
                    console.log('[TRACE] sample recruit check:', {
                        generalId: sampleGeneral.id,
                        leadership: sampleGeneral.stats.leadership,
                        cityId: sampleGeneral.cityId,
                        population: city?.population,
                        populationMax: city?.populationMax,
                    });
                }
                const nationGenerals = world.listGenerals().filter((general) => general.nationId === sampleNation.id);
                const crewOnly = nationGenerals.filter((general) => general.crew > 0);
                const crewWithType = crewOnly.filter((general) => general.crewTypeId > 0);
                console.log('[TRACE] crew stats:', {
                    totalGenerals: nationGenerals.length,
                    crewOnly: crewOnly.length,
                    crewWithType: crewWithType.length,
                });
            }
            throw error;
        }
    });
});
