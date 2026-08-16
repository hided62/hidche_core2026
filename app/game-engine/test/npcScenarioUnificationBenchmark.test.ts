import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildScenarioBootstrap, type City, type TurnSchedule } from '@sammo-ts/logic';
import { describe, expect, it } from 'vitest';

import { loadMapDefinitionByName } from '../src/scenario/mapLoader.js';
import { loadScenarioDefinitionById } from '../src/scenario/scenarioLoader.js';
import { loadUnitSetDefinitionByName } from '../src/scenario/unitSetLoader.js';
import { applyInitialChangeCityEvents } from '../src/turn/monthlyChangeCityAction.js';
import { createUnificationHandler } from '../src/turn/unificationHandler.js';
import type { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnTestHarness } from './helpers/turnTestHarness.js';
import { NpcUnificationTimingProfiler } from './helpers/npcUnificationTimingProfiler.js';

const benchmarkEnabled = process.env.NPC_UNIFICATION_BENCHMARK === '1';
const benchmarkDescribe = describe.runIf(benchmarkEnabled);
const SCENARIO_ID = 2601;
const HIDDEN_SEED = 'scenario-2601-npc-unification-benchmark-v1';
const CAPACITY_PROFILE = '1200-generals-5m';

const canonicalize = (value: unknown): string => {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (typeof value === 'bigint') return JSON.stringify(value.toString());
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
};

const hashWorldState = (world: InMemoryTurnWorld): string =>
    createHash('sha256')
        .update(
            canonicalize({
                state: world.getState(),
                generals: world.listGenerals().sort((left, right) => left.id - right.id),
                cities: world.listCities().sort((left, right) => left.id - right.id),
                nations: world.listNations().sort((left, right) => left.id - right.id),
            })
        )
        .digest('hex');

const buildCapacityGenerals = (
    sourceGenerals: readonly TurnGeneral[],
    npcCount: number,
    humanCount: number
): TurnGeneral[] => {
    if (sourceGenerals.length === 0) throw new Error('capacity benchmark requires scenario generals');
    const ordered = [...sourceGenerals].sort((left, right) => left.id - right.id);
    const clone = (source: TurnGeneral, id: number, humanIndex: number | null): TurnGeneral => ({
        ...source,
        id,
        name: id === source.id ? source.name : `${source.name}#L${id}`,
        userId: humanIndex === null ? null : `load-user-${String(humanIndex + 1).padStart(4, '0')}`,
        npcState: humanIndex === null ? Math.max(2, source.npcState) : 0,
        turnTime: new Date(source.turnTime),
        recentWarTime: source.recentWarTime ? new Date(source.recentWarTime) : null,
        lastTurn: source.lastTurn ? { ...source.lastTurn } : undefined,
        meta: { ...source.meta },
        penalty: source.penalty && typeof source.penalty === 'object' ? { ...source.penalty } : source.penalty,
        inheritancePoints: source.inheritancePoints ? { ...source.inheritancePoints } : undefined,
    });
    const result: TurnGeneral[] = [];
    for (let index = 0; index < npcCount; index += 1) {
        const source = ordered[index % ordered.length]!;
        result.push(clone(source, index + 1, null));
    }
    for (let index = 0; index < humanCount; index += 1) {
        const source = ordered[(npcCount + index) % ordered.length]!;
        result.push(clone(source, npcCount + index + 1, index));
    }
    return result;
};

const createGameDate = (year: number, month: number): Date => {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, 1);
    date.setUTCHours(0, 0, 0, 0);
    return date;
};

const buildTurnGeneral = (
    domainGeneral: ReturnType<typeof buildScenarioBootstrap>['snapshot']['generals'][number],
    seedGeneral: ReturnType<typeof buildScenarioBootstrap>['seed']['generals'][number],
    startTime: Date,
    startYear: number,
    startMonth: number
): TurnGeneral => {
    const deathMonthRaw = seedGeneral.meta.deathMonth;
    const deathMonth =
        typeof deathMonthRaw === 'number' && Number.isInteger(deathMonthRaw) ? deathMonthRaw : startMonth;
    const killturn = Math.max(0, (seedGeneral.deathYear - startYear) * 12 + (deathMonth - 1) + startMonth - 1);
    const initialTurnOffsetMicros =
        typeof seedGeneral.meta.initialTurnOffsetMicros === 'number' ? seedGeneral.meta.initialTurnOffsetMicros : 0;
    return {
        ...domainGeneral,
        userId: null,
        bornYear: seedGeneral.birthYear,
        deadYear: seedGeneral.deathYear,
        affinity: seedGeneral.affinity,
        picture: seedGeneral.picture === null ? null : String(seedGeneral.picture),
        startAge: 20,
        turnTime: new Date(startTime.getTime() + Math.floor(initialTurnOffsetMicros / 1_000)),
        recentWarTime: null,
        lastTurn: { command: '휴식' },
        penalty: {},
        inheritancePoints: {},
        meta: {
            ...domainGeneral.meta,
            ...seedGeneral.meta,
            killturn,
            npcType: seedGeneral.npcType,
            crewTypeId: seedGeneral.crewTypeId,
        },
    };
};

const buildTurnCity = (seed: ReturnType<typeof buildScenarioBootstrap>['seed']['cities'][number]): City => ({
    id: seed.id,
    name: seed.name,
    nationId: seed.nationId,
    level: seed.level,
    state: seed.state,
    population: seed.population,
    populationMax: seed.populationMax,
    agriculture: seed.agriculture,
    agricultureMax: seed.agricultureMax,
    commerce: seed.commerce,
    commerceMax: seed.commerceMax,
    security: seed.security,
    securityMax: seed.securityMax,
    supplyState: seed.supplyState,
    frontState: seed.frontState,
    defence: seed.defence,
    defenceMax: seed.defenceMax,
    wall: seed.wall,
    wallMax: seed.wallMax,
    meta: {
        ...seed.meta,
        region: seed.region,
        trust: seed.trust,
        trade: seed.trade,
        positionX: seed.position.x,
        positionY: seed.position.y,
    },
});

const applyConvergenceAssist = (world: InMemoryTurnWorld, mode: string): void => {
    if (mode !== 'nation-1-max-city') return;
    for (const city of world.listCities()) {
        if (city.nationId !== 1) continue;
        world.updateCity(city.id, {
            population: city.populationMax,
            agriculture: city.agricultureMax,
            commerce: city.commerceMax,
            security: city.securityMax,
            defence: city.defenceMax,
            wall: city.wallMax,
            meta: { ...city.meta, trust: 100 },
        });
    }
};

benchmarkDescribe('scenario 2601 NPC 완전 인메모리 천통 벤치마크', () => {
    it('DB와 Redis 없이 시작 상태부터 통일까지 자동 실행하고 상세 시간을 기록한다', async () => {
        const startedAtNs = process.hrtime.bigint();
        const scenario = await loadScenarioDefinitionById(SCENARIO_ID);
        const map = await loadMapDefinitionByName(scenario.config.environment.mapName);
        const unitSet = await loadUnitSetDefinitionByName(scenario.config.environment.unitSet);
        const startYear = scenario.startYear ?? 180;
        const startMonth = 1;
        const capacityProfile = process.env.NPC_UNIFICATION_BENCHMARK_PROFILE ?? '';
        const capacityMode = capacityProfile === CAPACITY_PROFILE;
        const turnMinutes = capacityMode ? 5 : 10;
        const startTime = createGameDate(startYear, startMonth);
        const bootstrap = buildScenarioBootstrap({
            scenario,
            map,
            unitSet,
            options: {
                hiddenSeed: HIDDEN_SEED,
                initialYear: startYear,
                initialMonth: startMonth,
                turnTermMinutes: turnMinutes,
                includeNeutralNationInSeed: true,
            },
        });
        expect(bootstrap.warnings).toEqual([]);

        const cities = applyInitialChangeCityEvents(bootstrap.seed.cities, bootstrap.seed.initialEvents).map(
            buildTurnCity
        );
        const domainGeneralById = new Map(bootstrap.snapshot.generals.map((general) => [general.id, general]));
        const scenarioGenerals = bootstrap.seed.generals.map((seedGeneral) => {
            const domainGeneral = domainGeneralById.get(seedGeneral.id);
            if (!domainGeneral) throw new Error(`missing domain general ${seedGeneral.id}`);
            return buildTurnGeneral(domainGeneral, seedGeneral, startTime, startYear, startMonth);
        });
        const expectedNpcGenerals = capacityMode ? 900 : scenarioGenerals.length;
        const expectedHumanGenerals = capacityMode ? 300 : 0;
        const generals = capacityMode
            ? buildCapacityGenerals(scenarioGenerals, expectedNpcGenerals, expectedHumanGenerals)
            : scenarioGenerals;

        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: bootstrap.snapshot.scenarioConfig,
            scenarioMeta: bootstrap.snapshot.scenarioMeta,
            worldConfig: {
                fiction: scenario.fiction,
                npcMode: 2,
                turnTermMinutes: turnMinutes,
                tournamentTrig: false,
            },
            map,
            unitSet,
            generals,
            cities,
            nations: bootstrap.snapshot.nations,
            troops: bootstrap.snapshot.troops,
            diplomacy: bootstrap.snapshot.diplomacy.map((entry) => ({
                fromNationId: entry.fromNationId,
                toNationId: entry.toNationId,
                state: entry.state,
                term: entry.durationMonths,
                dead: 0,
                meta: {},
            })),
            // This benchmark isolates general/nation commands and core monthly
            // handlers. Scenario event actions are excluded explicitly below.
            events: [],
            initialEvents: [],
        };
        const state: TurnWorldState = {
            id: 1,
            currentYear: startYear,
            currentMonth: startMonth,
            tickSeconds: turnMinutes * 60,
            lastTurnTime: startTime,
            clockBaseTime: startTime,
            clockTick: 0,
            clockMode: 'manual',
            clockWallAnchor: startTime,
            lastTurnTick: 0,
            meta: {
                scenarioId: SCENARIO_ID,
                scenarioMeta: bootstrap.seed.scenarioMeta,
                hiddenSeed: HIDDEN_SEED,
                seed: HIDDEN_SEED,
                initYear: startYear,
                initMonth: startMonth,
                fiction: scenario.fiction,
                killturn: 4800 / turnMinutes,
                develcost: 20,
                isUnited: 0,
                isunited: 0,
                lastGeneralId: Math.max(0, ...generals.map((general) => general.id)),
                lastNationId: 0,
                serverId: 'benchmark-scenario-2601',
            },
        };
        const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: turnMinutes }] };
        const worldRef = { current: null as InMemoryTurnWorld | null };
        const profiler = new NpcUnificationTimingProfiler();
        const turnStartedAt = new Map<number, bigint>();
        const convergenceAssist = process.env.NPC_UNIFICATION_BENCHMARK_CONVERGENCE_ASSIST ?? 'none';
        let foundedNationCount = 0;
        const discardedDrafts = { logs: 0, messages: 0, neutralAuctions: 0 };

        const unification = createUnificationHandler({
            profileName: 'benchmark-scenario-2601',
            getWorld: () => worldRef.current,
            dispatchUnitedEvents: async () => {},
        });
        const harness = await createTurnTestHarness({
            snapshot,
            state,
            schedule,
            map,
            worldRef,
            extraCalendarHandlers: [unification.handler],
            onActionProfiled: (payload) => profiler.observeAction(payload),
            turnProcessorOptions: {
                tickMinutes: turnMinutes,
                beforeExecuteGeneral: async (general) => {
                    turnStartedAt.set(general.id, process.hrtime.bigint());
                },
                afterExecuteGeneral: async (general) => {
                    const generalStartedAt = turnStartedAt.get(general.id);
                    if (generalStartedAt === undefined) throw new Error(`missing turn timer ${general.id}`);
                    const current = worldRef.current?.getState();
                    if (!current) throw new Error('world not initialized');
                    profiler.observeGeneralTurn({
                        year: current.currentYear,
                        month: current.currentMonth,
                        officerLevel: general.officerLevel,
                        durationNs: process.hrtime.bigint() - generalStartedAt,
                    });
                    turnStartedAt.delete(general.id);
                },
            },
        });

        const maximumYear = Number(process.env.NPC_UNIFICATION_BENCHMARK_MAX_YEAR ?? 300);
        const fixedCapacityMonths = Number(process.env.NPC_UNIFICATION_BENCHMARK_FIXED_MONTHS ?? 1);
        let simulatedCapacityMonths = 0;
        while (true) {
            const before = harness.world.getState();
            const monthStartedAtNs = process.hrtime.bigint();
            await harness.runOneTick({ budgetMs: 600_000, maxGenerals: 100_000, catchUpCap: 1 });
            profiler.observeMonth({
                year: before.currentYear,
                month: before.currentMonth,
                wallDurationMs: Number(process.hrtime.bigint() - monthStartedAtNs) / 1_000_000,
                activeNationCount: harness.world.listNations().filter((nation) => nation.level > 0).length,
                generalCount: harness.world.listGenerals().length,
            });
            applyConvergenceAssist(harness.world, convergenceAssist);
            const activeNationCount = harness.world.listNations().filter((nation) => nation.level > 0).length;
            foundedNationCount = Math.max(foundedNationCount, activeNationCount);
            const changes = harness.world.consumeDirtyState();
            discardedDrafts.logs += changes.logs.length;
            discardedDrafts.messages += changes.messages.length;
            discardedDrafts.neutralAuctions += changes.pendingNeutralAuctions.length;
            const reservedChanges = harness.reservedTurnStore.peekDirtyState();
            harness.reservedTurnStore.acknowledgeDirtyState(reservedChanges);

            const current = harness.world.getState();
            simulatedCapacityMonths += 1;
            const meta = current.meta as Record<string, unknown>;
            if ((meta.isUnited ?? meta.isunited ?? 0) !== 0) break;
            if (capacityMode && simulatedCapacityMonths >= fixedCapacityMonths) break;
            if (current.currentYear >= maximumYear) break;
        }

        const finalState = harness.world.getState();
        const finalMeta = finalState.meta as Record<string, unknown>;
        const unificationReached = (finalMeta.isUnited ?? finalMeta.isunited ?? 0) !== 0;
        const finalNationCount = harness.world.listNations().filter((nation) => nation.level > 0).length;
        const report = profiler.buildReport({
            startedAtNs,
            scenarioId: SCENARIO_ID,
            scenarioTitle: scenario.title,
            hiddenSeed: HIDDEN_SEED,
            initialGeneralCount: generals.length,
            initialCityCount: cities.length,
            startYear,
            startMonth,
            finalYear: finalState.currentYear,
            finalMonth: finalState.currentMonth,
            finalGeneralCount: harness.world.listGenerals().length,
            foundedNationCount,
            finalNationCount,
            unificationReached,
            convergenceAssist,
            discardedDrafts,
            ...(capacityMode
                ? {
                      capacity: {
                          profile: capacityProfile,
                          expectedNpcGenerals,
                          expectedHumanGenerals,
                          turnMinutes,
                          fixedMonths: fixedCapacityMonths,
                          finalStateSha256: hashWorldState(harness.world),
                      },
                  }
                : {}),
        });
        const reportPath = resolve(
            process.env.NPC_UNIFICATION_BENCHMARK_REPORT_PATH ?? 'test-results/npc-scenario-unification-benchmark.json'
        );
        mkdirSync(dirname(reportPath), { recursive: true });
        writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        console.log(
            `[NPC_UNIFICATION_BENCHMARK_REPORT]${JSON.stringify({
                reportPath,
                scenario: report.scenario,
                result: report.result,
                npcDecisionByOfficerGroup: report.npcDecisionByOfficerGroup,
                generalTurnByOfficerGroup: report.generalTurnByOfficerGroup,
                memory: report.memory,
            })}`
        );

        if (capacityMode) {
            expect(generals).toHaveLength(1_200);
            expect(generals.filter((general) => general.npcState >= 2)).toHaveLength(900);
            expect(generals.filter((general) => general.npcState === 0 && general.userId)).toHaveLength(300);
            expect(report.capacity?.generalTurns.count).toBeGreaterThanOrEqual(1_200);
            expect(report.capacity?.finalStateSha256).toMatch(/^[a-f0-9]{64}$/u);
        } else {
            expect(generals.length).toBeGreaterThanOrEqual(600);
            expect(unificationReached).toBe(true);
        }
        expect(cities.length).toBeGreaterThanOrEqual(90);
    }, 1_800_000);
});
