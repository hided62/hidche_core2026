import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { buildScenarioBootstrap, type TurnSchedule } from '@sammo-ts/logic';
import { describe, expect, it } from 'vitest';

import { loadMapDefinitionByName } from '../src/scenario/mapLoader.js';
import { loadScenarioDefinitionById } from '../src/scenario/scenarioLoader.js';
import { loadUnitSetDefinitionByName } from '../src/scenario/unitSetLoader.js';
import { EngineStateManager } from '../src/turn/engineStateManager.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import {
    buildNpcLifecycleMemoryReport,
    captureLifecycleMemorySample,
    type NpcLifecycleMemorySample,
    type NpcLifecycleMemoryScenario,
} from './helpers/npcLifecycleMemoryProfiler.js';

const profileEnabled = process.env.NPC_LIFECYCLE_MEMORY_PROFILE === '1';
const profileDescribe = describe.runIf(profileEnabled);
const SCENARIO_ID = 2601;
const HIDDEN_SEED = 'scenario-2601-npc-lifecycle-memory-v1';
const ROLLBACK_SENTINEL = new Error('npc-lifecycle-memory-rollback');
const VALID_SCENARIOS = new Set<NpcLifecycleMemoryScenario>([
    'steady-state',
    'growth',
    'death-drain',
    'balanced-churn',
    'rollback-churn',
]);

const readPositiveInteger = (name: string, fallback: number): number => {
    const raw = process.env[name];
    if (raw === undefined) {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer: ${raw}`);
    }
    return value;
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
    const killturn = Math.max(0, (seedGeneral.deathYear - startYear) * 12 + deathMonth - startMonth);
    return {
        ...domainGeneral,
        userId: null,
        bornYear: seedGeneral.birthYear,
        deadYear: seedGeneral.deathYear,
        affinity: seedGeneral.affinity,
        picture: seedGeneral.picture === null ? null : String(seedGeneral.picture),
        startAge: 20,
        turnTime: new Date(startTime),
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

const cloneNpcGeneral = (source: TurnGeneral, id: number): TurnGeneral => {
    const cloned = structuredClone(source);
    return {
        ...cloned,
        id,
        name: `${source.name}#M${id}`,
        userId: null,
        npcState: Math.max(2, source.npcState),
        nationId: 0,
        cityId: 0,
        troopId: 0,
        officerLevel: 0,
        meta: {
            ...cloned.meta,
            lifecycleMemoryFixture: true,
        },
    };
};

const createProfileWorld = async (initialGeneralCount: number) => {
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
            turnTermMinutes: 10,
            includeNeutralNationInSeed: true,
        },
    });
    if (bootstrap.warnings.length > 0) {
        throw new Error(`scenario bootstrap warnings: ${bootstrap.warnings.join(', ')}`);
    }
    const domainGeneralById = new Map(bootstrap.snapshot.generals.map((general) => [general.id, general]));
    const scenarioGenerals = bootstrap.seed.generals.map((seedGeneral) => {
        const domainGeneral = domainGeneralById.get(seedGeneral.id);
        if (!domainGeneral) {
            throw new Error(`missing scenario general: ${seedGeneral.id}`);
        }
        return buildTurnGeneral(domainGeneral, seedGeneral, startTime, startYear, startMonth);
    });
    const generals = Array.from({ length: initialGeneralCount }, (_, index) =>
        cloneNpcGeneral(scenarioGenerals[index % scenarioGenerals.length]!, index + 1)
    );
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: bootstrap.snapshot.scenarioConfig,
        scenarioMeta: bootstrap.snapshot.scenarioMeta,
        worldConfig: {
            fiction: scenario.fiction,
            npcMode: 2,
            turnTermMinutes: 10,
            tournamentTrig: false,
        },
        map,
        unitSet,
        generals,
        cities: bootstrap.snapshot.cities,
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
        events: [],
        initialEvents: [],
    };
    const state: TurnWorldState = {
        id: 1,
        currentYear: startYear,
        currentMonth: startMonth,
        tickSeconds: 600,
        lastTurnTime: startTime,
        clockBaseTime: startTime,
        clockTick: 0,
        clockMode: 'manual',
        clockWallAnchor: startTime,
        lastTurnTick: 0,
        meta: {
            scenarioId: SCENARIO_ID,
            hiddenSeed: HIDDEN_SEED,
            killturn: 480,
            lastGeneralId: initialGeneralCount,
            serverId: 'npc-lifecycle-memory-profile',
        },
    };
    const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
    const world = new InMemoryTurnWorld(state, snapshot, { schedule });
    const reservedTurns = new InMemoryReservedTurnStore({} as never, {
        maxGeneralTurns: 30,
        maxNationTurns: 12,
        leaseOwner: 'npc-lifecycle-memory-profile',
    });
    for (const general of generals) {
        reservedTurns.getGeneralTurns(general.id);
    }
    return { world, reservedTurns, templateGenerals: scenarioGenerals };
};

profileDescribe('NPC 생성·사망 장기 구동 메모리 프로파일', () => {
    it('격리 시나리오의 GC 안정 heap, rollback snapshot과 예약 큐 보유량을 기록한다', async () => {
        expect(typeof globalThis.gc).toBe('function');
        const rawScenario = process.env.NPC_LIFECYCLE_MEMORY_SCENARIO ?? 'balanced-churn';
        if (!VALID_SCENARIOS.has(rawScenario as NpcLifecycleMemoryScenario)) {
            throw new Error(`unknown NPC lifecycle memory scenario: ${rawScenario}`);
        }
        const scenario = rawScenario as NpcLifecycleMemoryScenario;
        const cycles = readPositiveInteger('NPC_LIFECYCLE_MEMORY_CYCLES', 80);
        const batchSize = readPositiveInteger('NPC_LIFECYCLE_MEMORY_BATCH_SIZE', 100);
        const sampleEvery = readPositiveInteger('NPC_LIFECYCLE_MEMORY_SAMPLE_EVERY', 5);
        const baseGeneralCount = readPositiveInteger('NPC_LIFECYCLE_MEMORY_BASE_GENERALS', 1_200);
        const pruneDeletedQueues = process.env.NPC_LIFECYCLE_MEMORY_PRUNE_DELETED === '1';
        const initialGeneralCount =
            scenario === 'death-drain' ? baseGeneralCount + cycles * batchSize : baseGeneralCount;
        const { world, reservedTurns, templateGenerals } = await createProfileWorld(initialGeneralCount);
        const stateManager = new EngineStateManager();
        stateManager.register('world', {
            capture: () => world.captureState(),
            restore: (snapshot) => world.restoreState(snapshot),
        });
        stateManager.register('reservedTurns', {
            capture: () => reservedTurns.captureTransactionState(),
            restore: (snapshot) => reservedTurns.restoreState(snapshot),
        });

        const startedAtMs = performance.now();
        const samples: NpcLifecycleMemorySample[] = [
            captureLifecycleMemorySample({
                world,
                reservedTurns,
                startedAtMs,
                cycle: 0,
                phase: 'initial',
                includePending: false,
                includeSnapshot: true,
            }),
        ];
        const activeGeneralIds = world
            .listGenerals()
            .map((general) => general.id)
            .sort((left, right) => left - right);
        let nextGeneralId = Math.max(...activeGeneralIds) + 1;
        let createdTotal = 0;
        let deletedTotal = 0;
        let rolledBackCycles = 0;

        const addGenerals = (count: number): void => {
            for (let index = 0; index < count; index += 1) {
                const generalId = nextGeneralId++;
                const source = templateGenerals[(generalId - 1) % templateGenerals.length]!;
                if (!world.addGeneral(cloneNpcGeneral(source, generalId))) {
                    throw new Error(`failed to add profile general ${generalId}`);
                }
                reservedTurns.ensureGeneralTurns(generalId);
                activeGeneralIds.push(generalId);
                createdTotal += 1;
            }
        };
        const deleteGenerals = (count: number): void => {
            const targetIds = activeGeneralIds.splice(0, count);
            for (const generalId of targetIds) {
                if (!world.deleteGeneralWithLifecycle(generalId, 180, 1)) {
                    throw new Error(`failed to delete profile general ${generalId}`);
                }
                deletedTotal += 1;
            }
        };

        for (let cycle = 1; cycle <= cycles; cycle += 1) {
            const sampledCycle = cycle % sampleEvery === 0 || cycle === cycles;
            try {
                await stateManager.transaction(() => {
                    if (scenario === 'steady-state') {
                        for (let index = 0; index < batchSize; index += 1) {
                            const generalId = activeGeneralIds[((cycle - 1) * batchSize + index) % activeGeneralIds.length]!;
                            const current = world.getGeneralById(generalId);
                            if (!current) {
                                throw new Error(`missing steady-state general ${generalId}`);
                            }
                            world.updateGeneral(generalId, { experience: current.experience + 1 });
                            reservedTurns.shiftGeneralTurns(generalId, -1);
                        }
                    } else if (scenario === 'growth') {
                        addGenerals(batchSize);
                    } else if (scenario === 'death-drain') {
                        deleteGenerals(batchSize);
                    } else if (scenario === 'balanced-churn') {
                        deleteGenerals(batchSize);
                        addGenerals(batchSize);
                    } else {
                        addGenerals(batchSize);
                        deleteGenerals(batchSize);
                    }

                    if (sampledCycle) {
                        samples.push(
                            captureLifecycleMemorySample({
                                world,
                                reservedTurns,
                                startedAtMs,
                                cycle,
                                phase: 'in-transaction',
                                includePending: true,
                                includeSnapshot: false,
                            })
                        );
                    }
                    if (scenario === 'rollback-churn') {
                        throw ROLLBACK_SENTINEL;
                    }

                    const worldChanges = world.peekDirtyState();
                    const reservedChanges = reservedTurns.peekDirtyState();
                    world.acknowledgeDirtyState(worldChanges);
                    reservedTurns.acknowledgeDirtyState(reservedChanges);
                    if (pruneDeletedQueues) {
                        reservedTurns.pruneDeletedEntityQueues(
                            worldChanges.deletedGenerals,
                            worldChanges.deletedNations
                        );
                    }
                });
            } catch (error) {
                if (scenario !== 'rollback-churn' || error !== ROLLBACK_SENTINEL) {
                    throw error;
                }
                rolledBackCycles += 1;
                activeGeneralIds.splice(0, activeGeneralIds.length, ...world.listGenerals().map((general) => general.id));
            }

            if (sampledCycle) {
                samples.push(
                    captureLifecycleMemorySample({
                        world,
                        reservedTurns,
                        startedAtMs,
                        cycle,
                        phase: 'post-flush',
                        includePending: true,
                        includeSnapshot: true,
                    })
                );
            }
        }

        const report = buildNpcLifecycleMemoryReport({
            scenario,
            pruneDeletedQueues,
            initialGeneralCount,
            cycles,
            batchSize,
            sampleEvery,
            createdTotal,
            deletedTotal,
            rolledBackCycles,
            startedAtMs,
            samples,
        });
        const reportPath = resolve(
            process.env.NPC_LIFECYCLE_MEMORY_CHILD_REPORT_PATH ??
                `test-results/npc-lifecycle-memory-${scenario}.json`
        );
        mkdirSync(dirname(reportPath), { recursive: true });
        writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        console.log(
            `[NPC_LIFECYCLE_MEMORY_REPORT]${JSON.stringify({
                reportPath,
                scenario: report.scenario,
                result: report.result,
                memory: report.memory,
            })}`
        );

        const expectedFinalGeneralCount =
            scenario === 'growth'
                ? initialGeneralCount + cycles * batchSize
                : scenario === 'death-drain'
                  ? baseGeneralCount
                  : initialGeneralCount;
        expect(report.result.finalGeneralCount).toBe(expectedFinalGeneralCount);
        expect(report.result.rolledBackCycles).toBe(scenario === 'rollback-churn' ? cycles : 0);
        if (pruneDeletedQueues || !['death-drain', 'balanced-churn'].includes(scenario)) {
            expect(report.result.deadQueueRetentionCount).toBe(0);
        } else {
            expect(report.result.deadQueueRetentionCount).toBe(cycles * batchSize);
        }
        expect(world.peekDirtyState().lifecycleEvents).toHaveLength(0);
        expect(reservedTurns.peekDirtyState().generalIds).toHaveLength(0);
    }, 600_000);
});
