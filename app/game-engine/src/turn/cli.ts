import type { TurnSchedule } from '@sammo-ts/logic';
import { parseOptionalBoolean, parseOptionalNumber, type GameClockMode } from '@sammo-ts/common';

import type { TurnRunBudget } from '../lifecycle/types.js';
import { resolveDatabaseUrl } from '../scenario/databaseUrl.js';
import { createTurnDaemonRuntime } from './turnDaemon.js';
import { createTurnDaemonMemoryReporter } from './turnDaemonMemoryReporter.js';

export interface TurnDaemonCliOptions {
    profile?: string;
    profileName?: string;
    scenario?: string;
    databaseUrl?: string;
    gatewayDatabaseUrl?: string;
    tickMinutes?: number;
    schedule?: TurnSchedule;
    budget?: Partial<TurnRunBudget>;
    enableDatabaseFlush?: boolean;
    adminActionIntervalMs?: number;
    memoryReportIntervalMs?: number;
    gameClockMode?: GameClockMode;
    env?: NodeJS.ProcessEnv;
}

const DEFAULT_BUDGET: TurnRunBudget = {
    budgetMs: 5000,
    maxGenerals: 200,
    catchUpCap: 1,
};

const DEFAULT_MEMORY_REPORT_INTERVAL_MS = 5 * 60 * 1000;
const MIN_MEMORY_REPORT_INTERVAL_MS = 10 * 1000;

const buildBudgetOverride = (env: NodeJS.ProcessEnv, override?: Partial<TurnRunBudget>): TurnRunBudget | undefined => {
    const budgetOverride: Partial<TurnRunBudget> = {
        budgetMs: parseOptionalNumber(env.TURN_BUDGET_MS),
        maxGenerals: parseOptionalNumber(env.TURN_MAX_GENERALS),
        catchUpCap: parseOptionalNumber(env.TURN_CATCH_UP_CAP),
        ...override,
    };

    const hasOverride = Object.values(budgetOverride).some((value) => value !== undefined);
    if (!hasOverride) {
        return undefined;
    }
    return { ...DEFAULT_BUDGET, ...budgetOverride };
};

export const runTurnDaemonCli = async (options: TurnDaemonCliOptions = {}): Promise<void> => {
    const env = options.env ?? process.env;
    const profile = options.profile ?? env.TURN_PROFILE ?? env.PROFILE ?? 'hwe';
    const scenario = options.scenario ?? env.TURN_SCENARIO ?? env.SCENARIO;
    const profileName = options.profileName ?? env.TURN_PROFILE_NAME ?? (scenario ? `${profile}:${scenario}` : profile);
    const databaseUrl = options.databaseUrl ?? (await resolveDatabaseUrl({ env, schema: profile }));
    const gatewayDatabaseUrl =
        options.gatewayDatabaseUrl ??
        env.GATEWAY_DATABASE_URL ??
        (await resolveDatabaseUrl({
            env,
            schema: env.GATEWAY_DB_SCHEMA ?? 'public',
        }));
    const budget = buildBudgetOverride(env, options.budget);
    const tickMinutes = options.tickMinutes ?? parseOptionalNumber(env.TURN_TICK_MINUTES);
    const enableDatabaseFlush = options.enableDatabaseFlush ?? parseOptionalBoolean(env.TURN_FLUSH_DB) ?? true;
    const pauseGateIntervalMs = parseOptionalNumber(env.TURN_PAUSE_GATE_MS);
    const adminActionIntervalMs = options.adminActionIntervalMs ?? parseOptionalNumber(env.TURN_ADMIN_ACTION_MS);
    const memoryReportIntervalMs =
        options.memoryReportIntervalMs ??
        parseOptionalNumber(env.TURN_MEMORY_REPORT_INTERVAL_MS) ??
        DEFAULT_MEMORY_REPORT_INTERVAL_MS;
    if (!Number.isFinite(memoryReportIntervalMs) || memoryReportIntervalMs < MIN_MEMORY_REPORT_INTERVAL_MS) {
        throw new Error(`TURN_MEMORY_REPORT_INTERVAL_MS must be at least ${MIN_MEMORY_REPORT_INTERVAL_MS}.`);
    }
    const rawGameClockMode = options.gameClockMode ?? env.GAME_CLOCK_MODE;
    if (rawGameClockMode && rawGameClockMode !== 'realtime' && rawGameClockMode !== 'manual') {
        throw new Error(`GAME_CLOCK_MODE must be realtime or manual: ${rawGameClockMode}`);
    }
    const gameClockMode = rawGameClockMode as GameClockMode | undefined;

    const runtime = await createTurnDaemonRuntime({
        profile,
        profileName,
        databaseUrl,
        gatewayDatabaseUrl,
        defaultBudget: budget,
        tickMinutes,
        schedule: options.schedule,
        enableDatabaseFlush,
        pauseGateIntervalMs,
        adminActionIntervalMs,
        gameClockMode,
    });

    const memoryReporter = createTurnDaemonMemoryReporter({
        profile,
        intervalMs: memoryReportIntervalMs,
        getContext: () => {
            const state = runtime.world.getState();
            const queueCounts = runtime.reservedTurns?.getQueueCounts();
            return {
                year: state.currentYear,
                month: state.currentMonth,
                ...runtime.world.getEntityCounts(),
                ...(queueCounts
                    ? {
                          generalTurnQueues: queueCounts.generalQueues,
                          nationTurnQueues: queueCounts.nationQueues,
                      }
                    : {}),
                lifecycleState: runtime.lifecycle.getStatus().state,
            };
        },
    });

    let closed = false;
    const closeOnce = async (): Promise<void> => {
        if (closed) {
            return;
        }
        closed = true;
        memoryReporter.report('shutdown');
        memoryReporter.stop();
        await runtime.close();
    };

    let stopping = false;
    const stop = async (reason: string): Promise<void> => {
        if (stopping) {
            return;
        }
        stopping = true;
        console.info(`[turn-daemon] stopping: ${reason}`);
        await runtime.lifecycle.stop(reason);
        await closeOnce();
    };

    process.on('SIGINT', () => void stop('SIGINT'));
    process.on('SIGTERM', () => void stop('SIGTERM'));

    const activeTickMinutes = tickMinutes ?? Math.max(1, Math.round(runtime.world.getState().tickSeconds / 60));
    console.info(`[turn-daemon] started profile=${profile} tickMinutes=${activeTickMinutes}`);
    memoryReporter.report('startup');

    try {
        await runtime.lifecycle.start();
    } finally {
        await closeOnce();
    }
};
