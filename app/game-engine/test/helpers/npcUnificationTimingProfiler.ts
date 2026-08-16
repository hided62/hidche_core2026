import os from 'node:os';

import type { createReservedTurnHandler } from '../../src/turn/reservedTurnHandler.js';

export type ProfiledAction = Parameters<
    NonNullable<Parameters<typeof createReservedTurnHandler>[0]['onActionProfiled']>
>[0];

type DurationSeries = {
    durationsNs: number[];
    totalNs: number;
};

type MonthBucket = {
    year: number;
    month: number;
    generalTurns: number;
    chiefGeneralTurns: number;
    ordinaryGeneralTurns: number;
    totalGeneralTurnNs: number;
    aiDecisionCount: number;
    aiDecisionNs: number;
    commandCount: number;
    commandExecutionNs: number;
    activeNationCount: number;
    generalCount: number;
};

const createSeries = (): DurationSeries => ({ durationsNs: [], totalNs: 0 });

const percentile = (values: readonly number[], ratio: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index] ?? 0;
};

const maximum = (values: readonly number[]): number => {
    let result = 0;
    for (const value of values) result = Math.max(result, value);
    return result;
};

const summarizeSeries = (series: DurationSeries) => ({
    count: series.durationsNs.length,
    totalMs: series.totalNs / 1_000_000,
    averageMs: series.durationsNs.length > 0 ? series.totalNs / series.durationsNs.length / 1_000_000 : 0,
    p50Ms: percentile(series.durationsNs, 0.5) / 1_000_000,
    p95Ms: percentile(series.durationsNs, 0.95) / 1_000_000,
    p99Ms: percentile(series.durationsNs, 0.99) / 1_000_000,
    maxMs: maximum(series.durationsNs) / 1_000_000,
});

const monthKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, '0')}`;

export class NpcUnificationTimingProfiler {
    private readonly allTurnSeries = createSeries();
    private readonly commandSeries = new Map<string, DurationSeries>();
    private readonly commandAiSeries = new Map<string, DurationSeries>();
    private readonly decisionSeries = new Map<'chief' | 'ordinary', DurationSeries>([
        ['chief', createSeries()],
        ['ordinary', createSeries()],
    ]);
    private readonly turnSeries = new Map<'chief' | 'ordinary', DurationSeries>([
        ['chief', createSeries()],
        ['ordinary', createSeries()],
    ]);
    private readonly months = new Map<string, MonthBucket>();
    private readonly monthWallMs = new Map<string, number>();
    private maxHeapUsedBytes = 0;
    private maxRssBytes = 0;

    private getMonth(year: number, month: number): MonthBucket {
        const key = monthKey(year, month);
        const existing = this.months.get(key);
        if (existing) return existing;
        const created: MonthBucket = {
            year,
            month,
            generalTurns: 0,
            chiefGeneralTurns: 0,
            ordinaryGeneralTurns: 0,
            totalGeneralTurnNs: 0,
            aiDecisionCount: 0,
            aiDecisionNs: 0,
            commandCount: 0,
            commandExecutionNs: 0,
            activeNationCount: 0,
            generalCount: 0,
        };
        this.months.set(key, created);
        return created;
    }

    observeAction(payload: ProfiledAction): void {
        const commandKey = `${payload.kind}:${payload.actionKey}`;
        const actionDurationNs = Number(payload.actionDurationNs);
        const command = this.commandSeries.get(commandKey) ?? createSeries();
        command.durationsNs.push(actionDurationNs);
        command.totalNs += actionDurationNs;
        this.commandSeries.set(commandKey, command);

        const month = this.getMonth(payload.year, payload.month);
        month.commandCount += 1;
        month.commandExecutionNs += actionDurationNs;

        if (!payload.usedAi) return;
        const decisionDurationNs = Number(payload.aiDecisionDurationNs);
        const commandAi = this.commandAiSeries.get(commandKey) ?? createSeries();
        commandAi.durationsNs.push(decisionDurationNs);
        commandAi.totalNs += decisionDurationNs;
        this.commandAiSeries.set(commandKey, commandAi);

        const officerGroup = payload.officerLevel >= 5 ? 'chief' : 'ordinary';
        const decision = this.decisionSeries.get(officerGroup)!;
        decision.durationsNs.push(decisionDurationNs);
        decision.totalNs += decisionDurationNs;
        month.aiDecisionCount += 1;
        month.aiDecisionNs += decisionDurationNs;
    }

    observeGeneralTurn(input: { year: number; month: number; officerLevel: number; durationNs: bigint }): void {
        const durationNs = Number(input.durationNs);
        this.allTurnSeries.durationsNs.push(durationNs);
        this.allTurnSeries.totalNs += durationNs;
        const officerGroup = input.officerLevel >= 5 ? 'chief' : 'ordinary';
        const series = this.turnSeries.get(officerGroup)!;
        series.durationsNs.push(durationNs);
        series.totalNs += durationNs;

        const month = this.getMonth(input.year, input.month);
        month.generalTurns += 1;
        month.totalGeneralTurnNs += durationNs;
        if (officerGroup === 'chief') month.chiefGeneralTurns += 1;
        else month.ordinaryGeneralTurns += 1;
    }

    observeMonth(input: {
        year: number;
        month: number;
        wallDurationMs: number;
        activeNationCount: number;
        generalCount: number;
    }): void {
        this.monthWallMs.set(monthKey(input.year, input.month), input.wallDurationMs);
        const month = this.getMonth(input.year, input.month);
        month.activeNationCount = input.activeNationCount;
        month.generalCount = input.generalCount;
        const usage = process.memoryUsage();
        this.maxHeapUsedBytes = Math.max(this.maxHeapUsedBytes, usage.heapUsed);
        this.maxRssBytes = Math.max(this.maxRssBytes, usage.rss);
    }

    buildReport(input: {
        startedAtNs: bigint;
        scenarioId: number;
        scenarioTitle: string;
        hiddenSeed: string;
        initialGeneralCount: number;
        initialCityCount: number;
        startYear: number;
        startMonth: number;
        finalYear: number;
        finalMonth: number;
        finalGeneralCount: number;
        foundedNationCount: number;
        finalNationCount: number;
        unificationReached: boolean;
        convergenceAssist: string;
        discardedDrafts: { logs: number; messages: number; neutralAuctions: number };
        capacity?: {
            profile: string;
            expectedNpcGenerals: number;
            expectedHumanGenerals: number;
            turnMinutes: number;
            fixedMonths: number;
            finalStateSha256: string;
        };
    }) {
        const commandKeys = Array.from(this.commandSeries.keys()).sort();
        const commands = commandKeys.map((key) => ({
            key,
            execution: summarizeSeries(this.commandSeries.get(key)!),
            aiDecision: summarizeSeries(this.commandAiSeries.get(key) ?? createSeries()),
        }));
        const months = Array.from(this.months.entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, bucket]) => ({
                key,
                year: bucket.year,
                month: bucket.month,
                generalTurns: bucket.generalTurns,
                chiefGeneralTurns: bucket.chiefGeneralTurns,
                ordinaryGeneralTurns: bucket.ordinaryGeneralTurns,
                activeNationCount: bucket.activeNationCount,
                generalCount: bucket.generalCount,
                wallDurationMs: this.monthWallMs.get(key) ?? 0,
                totalGeneralTurnMs: bucket.totalGeneralTurnNs / 1_000_000,
                averageGeneralTurnMs:
                    bucket.generalTurns > 0 ? bucket.totalGeneralTurnNs / bucket.generalTurns / 1_000_000 : 0,
                aiDecisionCount: bucket.aiDecisionCount,
                totalAiDecisionMs: bucket.aiDecisionNs / 1_000_000,
                averageAiDecisionMs:
                    bucket.aiDecisionCount > 0 ? bucket.aiDecisionNs / bucket.aiDecisionCount / 1_000_000 : 0,
                commandCount: bucket.commandCount,
                totalCommandExecutionMs: bucket.commandExecutionNs / 1_000_000,
                averageCommandExecutionMs:
                    bucket.commandCount > 0 ? bucket.commandExecutionNs / bucket.commandCount / 1_000_000 : 0,
            }));
        const startIndex = input.startYear * 12 + input.startMonth - 1;
        const finalIndex = input.finalYear * 12 + input.finalMonth - 1;

        const wallDurationMs = Number(process.hrtime.bigint() - input.startedAtNs) / 1_000_000;
        const monthWallSeries = {
            durationsNs: Array.from(this.monthWallMs.values(), (value) => value * 1_000_000),
            totalNs: Array.from(this.monthWallMs.values()).reduce((total, value) => total + value * 1_000_000, 0),
        };
        const capacityWindowMs = monthWallSeries.totalNs / 1_000_000;
        return {
            schemaVersion: 1,
            runtime: {
                node: process.version,
                platform: process.platform,
                arch: process.arch,
                cpuModel: os.cpus()[0]?.model ?? 'unknown',
                logicalCpuCount: os.cpus().length,
                totalMemoryBytes: os.totalmem(),
            },
            scenario: {
                id: input.scenarioId,
                title: input.scenarioTitle,
                hiddenSeed: input.hiddenSeed,
                initialGeneralCount: input.initialGeneralCount,
                initialCityCount: input.initialCityCount,
                startYear: input.startYear,
                startMonth: input.startMonth,
                convergenceAssist: input.convergenceAssist,
            },
            result: {
                unificationReached: input.unificationReached,
                finalYear: input.finalYear,
                finalMonth: input.finalMonth,
                simulatedMonths: finalIndex - startIndex,
                finalGeneralCount: input.finalGeneralCount,
                foundedNationCount: input.foundedNationCount,
                finalNationCount: input.finalNationCount,
                wallDurationMs,
                discardedDrafts: input.discardedDrafts,
            },
            npcDecisionByOfficerGroup: {
                chief: summarizeSeries(this.decisionSeries.get('chief')!),
                ordinary: summarizeSeries(this.decisionSeries.get('ordinary')!),
            },
            generalTurnByOfficerGroup: {
                chief: summarizeSeries(this.turnSeries.get('chief')!),
                ordinary: summarizeSeries(this.turnSeries.get('ordinary')!),
            },
            ...(input.capacity
                ? {
                      capacity: {
                          ...input.capacity,
                          generalTurns: summarizeSeries(this.allTurnSeries),
                          monthWall: summarizeSeries(monthWallSeries),
                          generalTurnsPerSecond:
                              capacityWindowMs > 0
                                  ? this.allTurnSeries.durationsNs.length / (capacityWindowMs / 1_000)
                                  : 0,
                      },
                  }
                : {}),
            memory: {
                maxObservedHeapUsedBytes: this.maxHeapUsedBytes,
                maxObservedRssBytes: this.maxRssBytes,
                processResourceMaxRssBytes: process.resourceUsage().maxRSS * 1024,
            },
            commands,
            months,
        };
    }
}
