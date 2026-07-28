import { performance } from 'node:perf_hooks';
import { serialize } from 'node:v8';

import type { InMemoryReservedTurnStore } from '../../src/turn/reservedTurnStore.js';
import type { InMemoryTurnWorld } from '../../src/turn/inMemoryWorld.js';

type MemoryUsageSnapshot = {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
};

export type NpcUnificationMemorySample = {
    label: string;
    year: number;
    month: number;
    activeNationCount: number;
    generalCount: number;
    cityCount: number;
    troopCount: number;
    processBeforeSnapshot: MemoryUsageSnapshot;
    processWithSnapshot: MemoryUsageSnapshot;
    processAfterRelease: MemoryUsageSnapshot;
    worldSnapshotBytes: number;
    reservedTurnSnapshotBytes: number;
    totalParticipantSnapshotBytes: number;
    participantSnapshotCloneMs: number;
};

type TickObservation = {
    heapUsedBytes: number;
    rssBytes: number;
};

const readMemoryUsage = (): MemoryUsageSnapshot => {
    const usage = process.memoryUsage();
    return {
        rssBytes: usage.rss,
        heapTotalBytes: usage.heapTotal,
        heapUsedBytes: usage.heapUsed,
        externalBytes: usage.external,
        arrayBuffersBytes: usage.arrayBuffers,
    };
};

const percentile = (values: number[], ratio: number): number => {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index] ?? 0;
};

const average = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export class NpcUnificationMemoryProfiler {
    private readonly samples: NpcUnificationMemorySample[] = [];
    private readonly tickObservations: TickObservation[] = [];

    constructor(
        private readonly world: InMemoryTurnWorld,
        private readonly reservedTurns: InMemoryReservedTurnStore
    ) {}

    observeTick(): void {
        const usage = readMemoryUsage();
        this.tickObservations.push({
            heapUsedBytes: usage.heapUsedBytes,
            rssBytes: usage.rssBytes,
        });
    }

    sample(label: string): NpcUnificationMemorySample {
        globalThis.gc?.();
        const processBeforeSnapshot = readMemoryUsage();
        const snapshotMetrics = (() => {
            const startedAt = performance.now();
            const worldSnapshot = this.world.captureState();
            const reservedTurnSnapshot = this.reservedTurns.captureState();
            return {
                participantSnapshotCloneMs: performance.now() - startedAt,
                processWithSnapshot: readMemoryUsage(),
                worldSnapshotBytes: serialize(worldSnapshot).byteLength,
                reservedTurnSnapshotBytes: serialize(reservedTurnSnapshot).byteLength,
            };
        })();
        globalThis.gc?.();
        const processAfterRelease = readMemoryUsage();

        const state = this.world.getState();
        const cities = this.world.listCities();
        const nations = this.world.listNations();
        const sample: NpcUnificationMemorySample = {
            label,
            year: state.currentYear,
            month: state.currentMonth,
            activeNationCount: nations.filter(
                (nation) => nation.level > 0 && cities.some((city) => city.nationId === nation.id)
            ).length,
            generalCount: this.world.listGenerals().length,
            cityCount: cities.length,
            troopCount: this.world.listTroops().length,
            processBeforeSnapshot,
            processWithSnapshot: snapshotMetrics.processWithSnapshot,
            processAfterRelease,
            worldSnapshotBytes: snapshotMetrics.worldSnapshotBytes,
            reservedTurnSnapshotBytes: snapshotMetrics.reservedTurnSnapshotBytes,
            totalParticipantSnapshotBytes:
                snapshotMetrics.worldSnapshotBytes + snapshotMetrics.reservedTurnSnapshotBytes,
            participantSnapshotCloneMs: snapshotMetrics.participantSnapshotCloneMs,
        };
        this.samples.push(sample);
        return sample;
    }

    buildReport(input: {
        startedAtMs: number;
        initialGeneralCount: number;
        foundedNationCount: number;
        declarationCount: number;
        sortieCount: number;
        unifiedAt: { year: number; month: number };
        startYear: number;
        startMonth: number;
    }) {
        const cloneTimes = this.samples.map((sample) => sample.participantSnapshotCloneMs);
        const snapshotSizes = this.samples.map((sample) => sample.totalParticipantSnapshotBytes);
        const retainedSnapshotHeapDeltas = this.samples.map(
            (sample) =>
                sample.processWithSnapshot.heapUsedBytes - sample.processBeforeSnapshot.heapUsedBytes
        );
        const releasedSnapshotHeapDeltas = this.samples.map(
            (sample) =>
                sample.processAfterRelease.heapUsedBytes - sample.processBeforeSnapshot.heapUsedBytes
        );
        const observedHeap = [
            ...this.tickObservations.map((entry) => entry.heapUsedBytes),
            ...this.samples.flatMap((sample) => [
                sample.processBeforeSnapshot.heapUsedBytes,
                sample.processWithSnapshot.heapUsedBytes,
                sample.processAfterRelease.heapUsedBytes,
            ]),
        ];
        const observedRss = [
            ...this.tickObservations.map((entry) => entry.rssBytes),
            ...this.samples.flatMap((sample) => [
                sample.processBeforeSnapshot.rssBytes,
                sample.processWithSnapshot.rssBytes,
                sample.processAfterRelease.rssBytes,
            ]),
        ];
        const startIndex = input.startYear * 12 + input.startMonth - 1;
        const unifiedIndex = input.unifiedAt.year * 12 + input.unifiedAt.month - 1;

        return {
            schemaVersion: 1,
            runtime: {
                node: process.version,
                platform: process.platform,
                arch: process.arch,
                explicitGc: typeof globalThis.gc === 'function',
            },
            scenario: {
                name: 'npcNationUprisingUnification-large-test-map',
                initialGeneralCount: input.initialGeneralCount,
                cityCount: this.samples[0]?.cityCount ?? 0,
                startYear: input.startYear,
                startMonth: input.startMonth,
            },
            result: {
                unifiedAt: input.unifiedAt,
                simulatedMonths: unifiedIndex - startIndex,
                foundedNationCount: input.foundedNationCount,
                declarationCount: input.declarationCount,
                sortieCount: input.sortieCount,
                wallDurationMs: performance.now() - input.startedAtMs,
            },
            memory: {
                processIncludes: ['node', 'vitest-worker', 'scenario-harness', 'engine-state'],
                maxObservedHeapUsedBytes: Math.max(0, ...observedHeap),
                maxObservedRssBytes: Math.max(0, ...observedRss),
                processResourceMaxRssBytes: process.resourceUsage().maxRSS * 1024,
                participantSnapshotBytes: {
                    initial: snapshotSizes[0] ?? 0,
                    final: snapshotSizes.at(-1) ?? 0,
                    peak: Math.max(0, ...snapshotSizes),
                },
                participantSnapshotHeapDeltaBytes: {
                    peakWhileRetained: Math.max(0, ...retainedSnapshotHeapDeltas),
                    peakAfterRelease: Math.max(0, ...releasedSnapshotHeapDeltas),
                },
                participantSnapshotCloneMs: {
                    count: cloneTimes.length,
                    average: average(cloneTimes),
                    p95: percentile(cloneTimes, 0.95),
                    max: Math.max(0, ...cloneTimes),
                },
            },
            samples: this.samples,
        };
    }
}
