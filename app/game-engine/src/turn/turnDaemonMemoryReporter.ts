import { getHeapStatistics } from 'node:v8';

export interface TurnDaemonMemoryContext {
    year: number;
    month: number;
    generals: number;
    cities: number;
    nations: number;
    troops: number;
    events: number;
    generalTurnQueues?: number;
    nationTurnQueues?: number;
    lifecycleState: string;
}

export interface TurnDaemonMemoryReporterOptions {
    profile: string;
    intervalMs: number;
    getContext(): TurnDaemonMemoryContext;
    info?: (message: string) => void;
    warn?: (message: string) => void;
}

const BYTES_PER_MIB = 1024 * 1024;
const HEAP_WARNING_RATIO = 0.8;

const toMiB = (value: number): number => Math.round((value / BYTES_PER_MIB) * 10) / 10;

export const buildTurnDaemonMemoryReport = (
    profile: string,
    reason: string,
    context: TurnDaemonMemoryContext,
    memory = process.memoryUsage(),
    heapLimitBytes = getHeapStatistics().heap_size_limit
): { message: string; warning: boolean } => {
    const heapRatio = heapLimitBytes > 0 ? memory.heapUsed / heapLimitBytes : 0;
    const message = [
        `[turn-daemon:memory] profile=${profile}`,
        `reason=${reason}`,
        `rssMiB=${toMiB(memory.rss)}`,
        `heapUsedMiB=${toMiB(memory.heapUsed)}`,
        `heapTotalMiB=${toMiB(memory.heapTotal)}`,
        `heapLimitMiB=${toMiB(heapLimitBytes)}`,
        `externalMiB=${toMiB(memory.external)}`,
        `arrayBuffersMiB=${toMiB(memory.arrayBuffers)}`,
        `year=${context.year}`,
        `month=${context.month}`,
        `generals=${context.generals}`,
        `cities=${context.cities}`,
        `nations=${context.nations}`,
        `troops=${context.troops}`,
        `events=${context.events}`,
        ...(context.generalTurnQueues === undefined
            ? []
            : [`generalTurnQueues=${context.generalTurnQueues}`]),
        ...(context.nationTurnQueues === undefined ? [] : [`nationTurnQueues=${context.nationTurnQueues}`]),
        `lifecycle=${context.lifecycleState}`,
    ].join(' ');
    return { message, warning: heapRatio >= HEAP_WARNING_RATIO };
};

export const createTurnDaemonMemoryReporter = (
    options: TurnDaemonMemoryReporterOptions
): { report(reason: string): void; stop(): void } => {
    const info = options.info ?? console.info;
    const warn = options.warn ?? console.warn;
    const report = (reason: string): void => {
        const result = buildTurnDaemonMemoryReport(options.profile, reason, options.getContext());
        (result.warning ? warn : info)(result.message);
    };
    const timer = setInterval(() => report('interval'), options.intervalMs);
    timer.unref();
    return {
        report,
        stop: () => clearInterval(timer),
    };
};
