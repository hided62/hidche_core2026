import { monitorEventLoopDelay } from 'node:perf_hooks';

export interface DistributionSummary {
    count: number;
    min: number | null;
    max: number | null;
    mean: number | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
}

const rounded = (value: number): number => Math.round(value * 1000) / 1000;

export const percentile = (sorted: readonly number[], percentileValue: number): number | null => {
    if (sorted.length === 0) return null;
    if (percentileValue <= 0) return sorted[0] ?? null;
    if (percentileValue >= 100) return sorted.at(-1) ?? null;
    const rank = Math.ceil((percentileValue / 100) * sorted.length) - 1;
    return sorted[Math.max(0, rank)] ?? null;
};

export const summarizeDistribution = (values: readonly number[]): DistributionSummary => {
    if (values.length === 0) return { count: 0, min: null, max: null, mean: null, p50: null, p95: null, p99: null };
    const sorted = [...values].sort((left, right) => left - right);
    const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
    return {
        count: sorted.length,
        min: rounded(sorted[0]!),
        max: rounded(sorted.at(-1)!),
        mean: rounded(mean),
        p50: rounded(percentile(sorted, 50)!),
        p95: rounded(percentile(sorted, 95)!),
        p99: rounded(percentile(sorted, 99)!),
    };
};

export class PhaseMetrics {
    readonly httpLatencyMs = new Map<string, number[]>();
    readonly httpSuccess = new Map<string, number>();
    readonly httpErrors = new Map<string, number>();
    readonly httpResults = new Map<string, number>();
    readonly sseEvents = new Map<string, number>();
    readonly processRssBytes: number[] = [];
    readonly sseActiveConnections: number[] = [];
    sseActiveCurrent = 0;
    sseAttempts = 0;
    sseOpened = 0;
    sseClosed = 0;
    sseReconnects = 0;
    sseFailures = 0;
    ssePrivacyViolations = 0;
    httpSourceRevisionObserved = 0;
    httpSourceRevisionKnownSent = 0;
    httpSourceRevisionMatchedUnchanged = 0;

    recordHttp(name: string, latencyMs: number, outcome: string | null): void {
        const values = this.httpLatencyMs.get(name) ?? [];
        values.push(latencyMs);
        this.httpLatencyMs.set(name, values);
        const target = outcome === null ? this.httpSuccess : this.httpErrors;
        const key = outcome === null ? name : `${name}:${outcome}`;
        target.set(key, (target.get(key) ?? 0) + 1);
    }

    recordSseEvent(name: string): void {
        const safeName = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(name) ? name : 'invalid-name';
        this.sseEvents.set(safeName, (this.sseEvents.get(safeName) ?? 0) + 1);
    }

    recordHttpResult(name: string, result: string): void {
        const safeResult = /^[a-z][a-z0-9-]{0,31}$/u.test(result) ? result : 'other';
        const key = `${name}:${safeResult}`;
        this.httpResults.set(key, (this.httpResults.get(key) ?? 0) + 1);
    }
}

const mapToObject = (value: ReadonlyMap<string, number>): Record<string, number> =>
    Object.fromEntries([...value.entries()].sort(([left], [right]) => left.localeCompare(right)));

export interface PhaseMetricSummary {
    http: {
        success: Record<string, number>;
        errors: Record<string, number>;
        results: Record<string, number>;
        latencyMs: Record<string, DistributionSummary>;
        sourceRevision: {
            observed: number;
            knownSent: number;
            matchedUnchanged: number;
        };
    };
    sse: {
        attempts: number;
        opened: number;
        closed: number;
        reconnects: number;
        failures: number;
        events: Record<string, number>;
        privacyViolations: number;
        activeConnections: DistributionSummary;
    };
    process: {
        cpuPercentOfOneCore: number;
        rssBytes: DistributionSummary;
        eventLoopLagMs: Omit<DistributionSummary, 'count' | 'mean'> & { mean: number };
    };
}

export class ProcessSampler {
    private readonly histogram = monitorEventLoopDelay({ resolution: 20 });
    private readonly startCpu = process.cpuUsage();
    private readonly startNs = process.hrtime.bigint();
    private timer: NodeJS.Timeout | null = null;

    constructor(private readonly metrics: PhaseMetrics) {}

    start(): void {
        this.histogram.enable();
        this.sample();
        this.timer = setInterval(() => this.sample(), 1000);
        this.timer.unref();
    }

    private sample(): void {
        this.metrics.processRssBytes.push(process.memoryUsage().rss);
        this.metrics.sseActiveConnections.push(this.metrics.sseActiveCurrent);
    }

    stop(activeConnections: number): PhaseMetricSummary['process'] {
        if (this.timer) clearInterval(this.timer);
        this.sample();
        this.metrics.sseActiveConnections.push(activeConnections);
        this.histogram.disable();
        const elapsedMs = Number(process.hrtime.bigint() - this.startNs) / 1_000_000;
        const cpu = process.cpuUsage(this.startCpu);
        const cpuMs = (cpu.user + cpu.system) / 1000;
        const fromNs = (value: number): number => (Number.isFinite(value) ? rounded(value / 1_000_000) : 0);
        return {
            cpuPercentOfOneCore: rounded((cpuMs / Math.max(elapsedMs, 1)) * 100),
            rssBytes: summarizeDistribution(this.metrics.processRssBytes),
            eventLoopLagMs: {
                min: fromNs(this.histogram.min),
                max: fromNs(this.histogram.max),
                mean: fromNs(this.histogram.mean),
                p50: fromNs(this.histogram.percentile(50)),
                p95: fromNs(this.histogram.percentile(95)),
                p99: fromNs(this.histogram.percentile(99)),
            },
        };
    }
}

export const summarizePhaseMetrics = (
    metrics: PhaseMetrics,
    processSummary: PhaseMetricSummary['process']
): PhaseMetricSummary => ({
    http: {
        success: mapToObject(metrics.httpSuccess),
        errors: mapToObject(metrics.httpErrors),
        results: mapToObject(metrics.httpResults),
        latencyMs: Object.fromEntries(
            [...metrics.httpLatencyMs.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([name, values]) => [name, summarizeDistribution(values)])
        ),
        sourceRevision: {
            observed: metrics.httpSourceRevisionObserved,
            knownSent: metrics.httpSourceRevisionKnownSent,
            matchedUnchanged: metrics.httpSourceRevisionMatchedUnchanged,
        },
    },
    sse: {
        attempts: metrics.sseAttempts,
        opened: metrics.sseOpened,
        closed: metrics.sseClosed,
        reconnects: metrics.sseReconnects,
        failures: metrics.sseFailures,
        events: mapToObject(metrics.sseEvents),
        privacyViolations: metrics.ssePrivacyViolations,
        activeConnections: summarizeDistribution(metrics.sseActiveConnections),
    },
    process: processSummary,
});
