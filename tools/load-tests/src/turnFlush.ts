import { monitorEventLoopDelay } from 'node:perf_hooks';

import {
    createTurnDaemonRuntime,
    getNextTickTime,
    type TurnCheckpoint,
    type TurnRunResult,
} from '@sammo-ts/game-engine';
import { createGamePostgresConnector, GamePrisma } from '@sammo-ts/infra';

import type { LoadConfig } from './config.js';
import { verifyCapacityFixture } from './fixture.js';
import { summarizeDistribution } from './metrics.js';

type DatabaseStatsRow = {
    xactCommit: bigint;
    xactRollback: bigint;
    blocksRead: bigint;
    blocksHit: bigint;
    tuplesReturned: bigint;
    tuplesFetched: bigint;
    tuplesInserted: bigint;
    tuplesUpdated: bigint;
    tuplesDeleted: bigint;
    tempFiles: bigint;
    tempBytes: bigint;
    deadlocks: bigint;
};

type ActivityRow = {
    connections: bigint;
    active: bigint;
    waitingLocks: bigint;
};

const readDatabaseStats = async (
    database: ReturnType<typeof createGamePostgresConnector>['prisma']
): Promise<DatabaseStatsRow> => {
    const rows = await database.$queryRaw<DatabaseStatsRow[]>(GamePrisma.sql`
        SELECT
            xact_commit AS "xactCommit",
            xact_rollback AS "xactRollback",
            blks_read AS "blocksRead",
            blks_hit AS "blocksHit",
            tup_returned AS "tuplesReturned",
            tup_fetched AS "tuplesFetched",
            tup_inserted AS "tuplesInserted",
            tup_updated AS "tuplesUpdated",
            tup_deleted AS "tuplesDeleted",
            temp_files AS "tempFiles",
            temp_bytes AS "tempBytes",
            deadlocks
        FROM pg_stat_database
        WHERE datname = current_database()
    `);
    const row = rows[0];
    if (!row) throw new Error('pg_stat_database did not return the current database');
    return row;
};

const subtractDatabaseStats = (before: DatabaseStatsRow, after: DatabaseStatsRow): Record<string, string> =>
    Object.fromEntries(
        Object.keys(before).map((key) => {
            const name = key as keyof DatabaseStatsRow;
            return [key, (after[name] - before[name]).toString()];
        })
    );

const readActivity = async (
    database: ReturnType<typeof createGamePostgresConnector>['prisma']
): Promise<ActivityRow> => {
    const rows = await database.$queryRaw<ActivityRow[]>(GamePrisma.sql`
        SELECT
            (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
            (
                SELECT count(*)
                FROM pg_stat_activity
                WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()
            ) AS active,
            (
                SELECT count(*)
                FROM pg_locks
                WHERE NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
            ) AS "waitingLocks"
    `);
    const row = rows[0];
    if (!row) throw new Error('PostgreSQL activity sampler returned no row');
    return row;
};

const round = (value: number): number => Math.round(value * 1000) / 1000;

const includeSubMillisecondGameTick = (turnTime: Date): Date =>
    // Game ticks are finer than JavaScript Date's millisecond precision. The
    // loader projects authoritative turn_tick to a floored Date, so replaying
    // that exact Date can map to a tick just before the general is due.
    new Date(turnTime.getTime() + 1);

/**
 * Runs exactly one logical month through the production loader, lease/fencing,
 * dirty-state flush, journal/outbox and Redis publication boundaries. General
 * turns are committed one at a time in chronological order, matching a healthy
 * realtime daemon rather than a catch-up chunk.
 */
export const measureTurnFlush = async (options: {
    config: LoadConfig;
    confirmation: string;
    env?: NodeJS.ProcessEnv;
}) => {
    const env = options.env ?? process.env;
    if (options.confirmation !== options.config.isolation.postgresSchema) {
        throw new Error('turn-flush confirmation must exactly equal isolation.postgresSchema');
    }
    const databaseUrl = env.LOAD_TEST_DATABASE_URL;
    const redisUrl = env.LOAD_TEST_REDIS_URL;
    if (!databaseUrl || !redisUrl) {
        throw new Error('LOAD_TEST_DATABASE_URL and LOAD_TEST_REDIS_URL are required');
    }
    const fixture = await verifyCapacityFixture(options.config, env);
    if (!fixture.valid) throw new Error('fixture verification failed; refusing turn-flush measurement');

    const observer = createGamePostgresConnector({ url: databaseUrl });
    await observer.connect();
    let beforeStats: DatabaseStatsRow;
    try {
        beforeStats = await readDatabaseStats(observer.prisma);
    } catch (error) {
        await observer.disconnect().catch(() => undefined);
        throw error;
    }
    const activity = {
        samples: 0,
        failures: 0,
        maxConnections: 0,
        maxActive: 0,
        maxWaitingLocks: 0,
    };
    let sampling = true;
    const sampleActivity = async (): Promise<void> => {
        while (sampling) {
            try {
                const sample = await readActivity(observer.prisma);
                activity.samples += 1;
                activity.maxConnections = Math.max(activity.maxConnections, Number(sample.connections));
                activity.maxActive = Math.max(activity.maxActive, Number(sample.active));
                activity.maxWaitingLocks = Math.max(activity.maxWaitingLocks, Number(sample.waitingLocks));
            } catch {
                activity.failures += 1;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    };
    const activityPromise = sampleActivity();

    const histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
    const cpuStart = process.cpuUsage();
    const wallStartNs = process.hrtime.bigint();
    let maxRssBytes = process.memoryUsage().rss;
    const generalTransactionMs: number[] = [];
    const monthlyTransactionMs: number[] = [];
    const publicationMs: number[] = [];
    let processedGenerals = 0;
    let processedMonths = 0;
    let runtime: Awaited<ReturnType<typeof createTurnDaemonRuntime>> | null = null;
    let startYearMonth: string | null = null;
    let endYearMonth: string | null = null;
    let initialGeneralCount: number | null = null;
    let finalGeneralCount: number | null = null;
    let runError: unknown;

    try {
        runtime = await createTurnDaemonRuntime({
            // Omitting profileName deliberately disables the Gateway admin-action
            // consumer. The load schema contains game tables only; the scoped
            // profile value still isolates the lease and Redis channel.
            profile: options.config.isolation.profileName,
            databaseUrl,
            redisUrl,
            gameClockMode: 'manual',
            enableDatabaseFlush: true,
            enableLeaseHeartbeat: true,
            databaseTransactionTimeoutMs: 30_000,
        });
        const initialState = runtime.world.getState();
        initialGeneralCount = runtime.world.listGenerals().length;
        startYearMonth = `${initialState.currentYear}-${String(initialState.currentMonth).padStart(2, '0')}`;
        const tickMinutes = Math.max(1, Math.round(initialState.tickSeconds / 60));
        const boundary = getNextTickTime(initialState.lastTurnTime, tickMinutes);
        let checkpoint: TurnCheckpoint | undefined = await runtime.stateStore.loadCheckpoint();

        const execute = async (target: Date, maxGenerals: number): Promise<TurnRunResult> => {
            const started = performance.now();
            const result = await runtime!.stateManager.transaction(async () => {
                await runtime!.stateStore.advanceGameClockTo(target, new Date());
                const next = await runtime!.processor.run(
                    target,
                    { budgetMs: 30_000, maxGenerals, catchUpCap: 1 },
                    checkpoint
                );
                await runtime!.stateStore.saveLastTurnTime(new Date(next.lastTurnTime));
                await runtime!.stateStore.saveCheckpoint(next.checkpoint);
                await runtime!.hooks?.flushChanges?.(next);
                return next;
            });
            const transactionMs = performance.now() - started;
            checkpoint = result.checkpoint;
            maxRssBytes = Math.max(maxRssBytes, process.memoryUsage().rss);
            const publishStarted = performance.now();
            await runtime!.hooks?.publishEvents?.(result);
            publicationMs.push(performance.now() - publishStarted);
            if (result.processedTurns > 0) monthlyTransactionMs.push(transactionMs);
            else generalTransactionMs.push(transactionMs);
            processedGenerals += result.processedGenerals;
            processedMonths += result.processedTurns;
            return result;
        };

        while (true) {
            const nextGeneral = await runtime.stateStore.loadNextGeneralTurnTime();
            if (!nextGeneral || nextGeneral.getTime() >= boundary.getTime()) break;
            const result = await execute(includeSubMillisecondGameTick(nextGeneral), 1);
            if (result.processedGenerals !== 1 || result.processedTurns !== 0) {
                throw new Error(
                    `chronological turn-flush run expected one general and zero months; got ${result.processedGenerals} generals and ${result.processedTurns} months`
                );
            }
        }

        const monthly = await execute(boundary, 200);
        if (monthly.processedTurns !== 1) {
            throw new Error('turn-flush measurement did not cross exactly one monthly boundary');
        }
        const finalState = runtime.world.getState();
        finalGeneralCount = runtime.world.listGenerals().length;
        endYearMonth = `${finalState.currentYear}-${String(finalState.currentMonth).padStart(2, '0')}`;
    } catch (error) {
        runError = error;
    } finally {
        try {
            await runtime?.close();
        } catch (error) {
            runError ??= error;
        }
        sampling = false;
        try {
            await activityPromise;
        } catch (error) {
            runError ??= error;
        }
    }
    if (runError !== undefined) {
        histogram.disable();
        await observer.disconnect().catch(() => undefined);
        throw runError;
    }
    if (
        startYearMonth === null ||
        endYearMonth === null ||
        initialGeneralCount === null ||
        finalGeneralCount === null
    ) {
        histogram.disable();
        await observer.disconnect().catch(() => undefined);
        throw new Error('turn-flush measurement completed without a full result');
    }

    let afterStats: DatabaseStatsRow;
    try {
        afterStats = await readDatabaseStats(observer.prisma);
    } catch (error) {
        histogram.disable();
        await observer.disconnect().catch(() => undefined);
        throw error;
    }
    await observer.disconnect();
    histogram.disable();
    const elapsedMs = Number(process.hrtime.bigint() - wallStartNs) / 1_000_000;
    const cpu = process.cpuUsage(cpuStart);
    const cpuMs = (cpu.user + cpu.system) / 1_000;
    const fromNs = (value: number): number => (Number.isFinite(value) ? round(value / 1_000_000) : 0);

    return {
        version: 1,
        fixture: {
            name: options.config.name,
            fixtureSha256: fixture.fixtureSha256,
            capacity: options.config.capacity,
        },
        mode: 'chronological-one-general-per-transaction-plus-month-boundary',
        startYearMonth,
        endYearMonth,
        elapsedMs: round(elapsedMs),
        throughput: {
            generalTurnsPerSecond: round(processedGenerals / Math.max(elapsedMs / 1_000, 0.001)),
            processedGenerals,
            processedMonths,
        },
        population: {
            initialGenerals: initialGeneralCount,
            finalGenerals: finalGeneralCount,
            generalDelta: finalGeneralCount - initialGeneralCount,
        },
        latencyMs: {
            generalTransaction: summarizeDistribution(generalTransactionMs),
            monthlyTransaction: summarizeDistribution(monthlyTransactionMs),
            redisPublication: summarizeDistribution(publicationMs),
        },
        postgres: {
            statsScope: 'database-wide-including-observer-sampler',
            statsDelta: subtractDatabaseStats(beforeStats, afterStats),
            activity,
        },
        process: {
            cpuPercentOfOneCore: round((cpuMs / Math.max(elapsedMs, 1)) * 100),
            maxRssBytes,
            eventLoopLagMs: {
                min: fromNs(histogram.min),
                max: fromNs(histogram.max),
                mean: fromNs(histogram.mean),
                p50: fromNs(histogram.percentile(50)),
                p95: fromNs(histogram.percentile(95)),
                p99: fromNs(histogram.percentile(99)),
            },
        },
        measuredAt: new Date().toISOString(),
    };
};
