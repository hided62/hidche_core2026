import { performance } from 'node:perf_hooks';
import { serialize } from 'node:v8';

import type { InMemoryTurnWorld } from '../../src/turn/inMemoryWorld.js';
import type {
    InMemoryReservedTurnStore,
    ReservedTurnQueueCounts,
} from '../../src/turn/reservedTurnStore.js';

export type NpcLifecycleMemoryScenario =
    | 'steady-state'
    | 'growth'
    | 'death-drain'
    | 'balanced-churn'
    | 'rollback-churn';

export interface ProcessMemorySnapshot {
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
}

export interface NpcLifecycleMemorySample {
    cycle: number;
    phase: 'initial' | 'in-transaction' | 'post-flush';
    elapsedMs: number;
    liveGeneralCount: number;
    queueCounts: ReservedTurnQueueCounts;
    process: ProcessMemorySnapshot;
    pending?: {
        createdGenerals: number;
        deletedGenerals: number;
        lifecycleEvents: number;
        reservedGeneralQueues: number;
    };
    snapshot?: {
        worldBytes: number;
        reservedTurnBytes: number;
        totalBytes: number;
        cloneAndSerializeMs: number;
        heapUsedAfterReleaseBytes: number;
    };
}

export const readProcessMemory = (): ProcessMemorySnapshot => {
    const usage = process.memoryUsage();
    return {
        rssBytes: usage.rss,
        heapTotalBytes: usage.heapTotal,
        heapUsedBytes: usage.heapUsed,
        externalBytes: usage.external,
        arrayBuffersBytes: usage.arrayBuffers,
    };
};

export const linearRegressionSlope = (points: ReadonlyArray<{ x: number; y: number }>): number => {
    if (points.length < 2) {
        return 0;
    }
    const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    let numerator = 0;
    let denominator = 0;
    for (const point of points) {
        const xDelta = point.x - meanX;
        numerator += xDelta * (point.y - meanY);
        denominator += xDelta * xDelta;
    }
    return denominator === 0 ? 0 : numerator / denominator;
};

export const captureLifecycleMemorySample = (input: {
    world: InMemoryTurnWorld;
    reservedTurns: InMemoryReservedTurnStore;
    startedAtMs: number;
    cycle: number;
    phase: NpcLifecycleMemorySample['phase'];
    includePending: boolean;
    includeSnapshot: boolean;
}): NpcLifecycleMemorySample => {
    globalThis.gc?.();
    const processSnapshot = readProcessMemory();
    const pending = input.includePending
        ? (() => {
              const worldChanges = input.world.peekDirtyState();
              const reservedChanges = input.reservedTurns.peekDirtyState();
              return {
                  createdGenerals: worldChanges.createdGenerals.length,
                  deletedGenerals: worldChanges.deletedGenerals.length,
                  lifecycleEvents: worldChanges.lifecycleEvents.length,
                  reservedGeneralQueues: reservedChanges.generalIds.length,
              };
          })()
        : undefined;
    const sample: NpcLifecycleMemorySample = {
        cycle: input.cycle,
        phase: input.phase,
        elapsedMs: performance.now() - input.startedAtMs,
        liveGeneralCount: input.world.getEntityCounts().generals,
        queueCounts: input.reservedTurns.getQueueCounts(),
        process: processSnapshot,
        ...(pending ? { pending } : {}),
    };
    if (input.includeSnapshot) {
        const snapshotMetrics = (() => {
            const snapshotStartedAt = performance.now();
            const worldSnapshot = input.world.captureState();
            const reservedSnapshot = input.reservedTurns.captureTransactionState();
            const worldBytes = serialize(worldSnapshot).byteLength;
            const reservedTurnBytes = serialize(reservedSnapshot).byteLength;
            return {
                worldBytes,
                reservedTurnBytes,
                cloneAndSerializeMs: performance.now() - snapshotStartedAt,
            };
        })();
        globalThis.gc?.();
        sample.snapshot = {
            ...snapshotMetrics,
            totalBytes: snapshotMetrics.worldBytes + snapshotMetrics.reservedTurnBytes,
            heapUsedAfterReleaseBytes: readProcessMemory().heapUsedBytes,
        };
    }
    return sample;
};

const maxValue = (values: readonly number[]): number => Math.max(0, ...values);

export const buildNpcLifecycleMemoryReport = (input: {
    scenario: NpcLifecycleMemoryScenario;
    pruneDeletedQueues: boolean;
    initialGeneralCount: number;
    cycles: number;
    batchSize: number;
    sampleEvery: number;
    createdTotal: number;
    deletedTotal: number;
    rolledBackCycles: number;
    startedAtMs: number;
    samples: NpcLifecycleMemorySample[];
}) => {
    const retained = input.samples.filter(
        (sample) => sample.phase === 'initial' || sample.phase === 'post-flush'
    );
    const warmSampleIndex = Math.floor(retained.length / 3);
    const trendSamples = retained.slice(warmSampleIndex);
    const first = retained[0];
    const final = retained.at(-1);
    const heapSlope = linearRegressionSlope(
        trendSamples.map((sample) => ({ x: sample.cycle, y: sample.process.heapUsedBytes }))
    );
    const snapshotSlope = linearRegressionSlope(
        trendSamples.flatMap((sample) =>
            sample.snapshot ? [{ x: sample.cycle, y: sample.snapshot.totalBytes }] : []
        )
    );
    const queueSlope = linearRegressionSlope(
        trendSamples.map((sample) => ({ x: sample.cycle, y: sample.queueCounts.generalQueues }))
    );
    const lifecycleOperations = input.createdTotal + input.deletedTotal;

    return {
        schemaVersion: 1,
        runtime: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            explicitGc: typeof globalThis.gc === 'function',
        },
        scenario: {
            name: input.scenario,
            pruneDeletedQueues: input.pruneDeletedQueues,
            initialGeneralCount: input.initialGeneralCount,
            cycles: input.cycles,
            batchSize: input.batchSize,
            sampleEvery: input.sampleEvery,
        },
        result: {
            createdTotal: input.createdTotal,
            deletedTotal: input.deletedTotal,
            rolledBackCycles: input.rolledBackCycles,
            finalGeneralCount: final?.liveGeneralCount ?? 0,
            finalGeneralQueueCount: final?.queueCounts.generalQueues ?? 0,
            deadQueueRetentionCount:
                (final?.queueCounts.generalQueues ?? 0) - (final?.liveGeneralCount ?? 0),
            wallDurationMs: performance.now() - input.startedAtMs,
        },
        memory: {
            retainedHeapStartBytes: first?.process.heapUsedBytes ?? 0,
            retainedHeapFinalBytes: final?.process.heapUsedBytes ?? 0,
            retainedHeapDeltaBytes:
                (final?.process.heapUsedBytes ?? 0) - (first?.process.heapUsedBytes ?? 0),
            retainedHeapSlopeBytesPerCycle: heapSlope,
            retainedHeapSlopeBytesPerLifecycleOperation:
                lifecycleOperations === 0 ? 0 : (heapSlope * input.cycles) / lifecycleOperations,
            retainedSnapshotStartBytes: first?.snapshot?.totalBytes ?? 0,
            retainedSnapshotFinalBytes: final?.snapshot?.totalBytes ?? 0,
            retainedSnapshotDeltaBytes:
                (final?.snapshot?.totalBytes ?? 0) - (first?.snapshot?.totalBytes ?? 0),
            retainedSnapshotSlopeBytesPerCycle: snapshotSlope,
            generalQueueSlopePerCycle: queueSlope,
            maxObservedHeapUsedBytes: maxValue(input.samples.map((sample) => sample.process.heapUsedBytes)),
            maxObservedRssBytes: maxValue(input.samples.map((sample) => sample.process.rssBytes)),
            processResourceMaxRssBytes: process.resourceUsage().maxRSS * 1024,
        },
        samples: input.samples,
    };
};
