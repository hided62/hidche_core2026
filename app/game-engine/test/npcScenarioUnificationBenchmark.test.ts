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
const TURN_MINUTES = 10;

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
        const startTime = createGameDate(startYear, startMonth);
        const bootstrap = buildScenarioBootstrap({
            scenario,
            map,
            unitSet,
            options: {
                hiddenSeed: HIDDEN_SEED,
                initialYear: startYear,
                initialMonth: startMonth,
                turnTermMinutes: TURN_MINUTES,
                includeNeutralNationInSeed: true,
            },
        });
        expect(bootstrap.warnings).toEqual([]);

        const cities = applyInitialChangeCityEvents(bootstrap.seed.cities, bootstrap.seed.initialEvents).map(
            buildTurnCity
        );
        const domainGeneralById = new Map(bootstrap.snapshot.generals.map((general) => [general.id, general]));
        const generals = bootstrap.seed.generals.map((seedGeneral) => {
            const domainGeneral = domainGeneralById.get(seedGeneral.id);
            if (!domainGeneral) throw new Error(`missing domain general ${seedGeneral.id}`);
            return buildTurnGeneral(domainGeneral, seedGeneral, startTime, startYear, startMonth);
        });

        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: bootstrap.snapshot.scenarioConfig,
            scenarioMeta: bootstrap.snapshot.scenarioMeta,
            worldConfig: {
                fiction: scenario.fiction,
                npcMode: 2,
                turnTermMinutes: TURN_MINUTES,
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
            tickSeconds: TURN_MINUTES * 60,
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
                killturn: 4800 / TURN_MINUTES,
                develcost: 20,
                isUnited: 0,
                isunited: 0,
                lastGeneralId: Math.max(0, ...generals.map((general) => general.id)),
                lastNationId: 0,
                serverId: 'benchmark-scenario-2601',
            },
        };
        const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: TURN_MINUTES }] };
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
                tickMinutes: TURN_MINUTES,
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
            const meta = current.meta as Record<string, unknown>;
            if ((meta.isUnited ?? meta.isunited ?? 0) !== 0) break;
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

        expect(generals.length).toBeGreaterThanOrEqual(600);
        expect(cities.length).toBeGreaterThanOrEqual(90);
        expect(unificationReached).toBe(true);
    }, 1_800_000);
});
