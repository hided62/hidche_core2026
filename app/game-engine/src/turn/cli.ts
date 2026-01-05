import type { TurnSchedule } from '@sammo-ts/logic';

import type { TurnRunBudget } from '../lifecycle/types.js';
import { resolveDatabaseUrl } from '../scenario/databaseUrl.js';
import { createTurnDaemonRuntime } from './turnDaemon.js';

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
    env?: NodeJS.ProcessEnv;
}

const DEFAULT_BUDGET: TurnRunBudget = {
    budgetMs: 5000,
    maxGenerals: 200,
    catchUpCap: 1,
};

const parseNumber = (value: string | undefined): number | undefined => {
    if (!value) {
        return undefined;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }
    return parsed;
};

const parseBoolean = (value: string | undefined): boolean | undefined => {
    if (!value) {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
        return false;
    }
    return undefined;
};

const buildBudgetOverride = (env: NodeJS.ProcessEnv, override?: Partial<TurnRunBudget>): TurnRunBudget | undefined => {
    const budgetOverride: Partial<TurnRunBudget> = {
        budgetMs: parseNumber(env.TURN_BUDGET_MS),
        maxGenerals: parseNumber(env.TURN_MAX_GENERALS),
        catchUpCap: parseNumber(env.TURN_CATCH_UP_CAP),
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
    const tickMinutes = options.tickMinutes ?? parseNumber(env.TURN_TICK_MINUTES);
    const enableDatabaseFlush = options.enableDatabaseFlush ?? parseBoolean(env.TURN_FLUSH_DB) ?? true;
    const pauseGateIntervalMs = parseNumber(env.TURN_PAUSE_GATE_MS);
    const adminActionIntervalMs = options.adminActionIntervalMs ?? parseNumber(env.TURN_ADMIN_ACTION_MS);

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
    });

    let closed = false;
    const closeOnce = async (): Promise<void> => {
        if (closed) {
            return;
        }
        closed = true;
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

    try {
        await runtime.lifecycle.start();
    } finally {
        await closeOnce();
    }
};
