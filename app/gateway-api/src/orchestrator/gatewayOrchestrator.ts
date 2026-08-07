import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { ScenarioInstallOptions } from '@sammo-ts/game-engine/scenario/scenarioSeeder.js';
import {
    createGamePostgresConnector,
    createRedisConnector,
    resolvePostgresConfigFromEnv,
    resolveRedisConfigFromEnv,
} from '@sammo-ts/infra';
import { isRecord } from '@sammo-ts/common';

import type { BuildCommand, BuildRunner } from './buildRunner.js';
import { sanitizeManagedProcessEnv, type ProcessManager } from './processManager.js';
import type {
    GatewayClaimedProfileUpdate,
    GatewayOperationRecord,
    GatewayProfileRecord,
    GatewayProfileRepository,
    GatewayProfileStatus,
} from './profileRepository.js';
import type { GitWorkspaceManager } from './workspaceManager.js';
import type { AdminSeedUser } from './seedProfileDatabase.js';
import { assertReleaseComponents, readReleaseManifest } from './releaseManifest.js';

export interface GatewayProcessConfig {
    workspaceRoot: string;
    redisKeyPrefix: string;
    gameTokenSecret: string;
    gatewayInternalApiUrl: string;
    baseEnv?: Record<string, string>;
}

export interface GatewayOrchestratorOptions {
    repository: GatewayProfileRepository;
    processManager: ProcessManager;
    buildRunner: BuildRunner;
    workspaceManager: GitWorkspaceManager;
    processConfig: GatewayProcessConfig;
    reconcileIntervalMs: number;
    scheduleIntervalMs: number;
    buildIntervalMs: number;
    adminActionIntervalMs: number;
    profileReadinessTimeoutMs?: number;
    now?: () => Date;
    fetchImpl?: typeof fetch;
    clearTournamentRuntimeState?: (profileName: string) => Promise<void>;
}

export interface ProfileRuntimeState {
    frontendRunning: boolean;
    apiRunning: boolean;
    daemonRunning: boolean;
    auctionRunning: boolean;
    battleSimRunning: boolean;
    tournamentRunning: boolean;
}

export interface ProfileRuntimeSnapshot extends ProfileRuntimeState {
    profileName: string;
}

export interface GatewayOrchestratorHandle {
    start(): void;
    stop(): Promise<void>;
    reconcileNow(): Promise<void>;
    runScheduleNow(): Promise<void>;
    runBuildQueueNow(): Promise<void>;
    runOperationsNow(): Promise<void>;
    cleanupStaleWorkspaces(): Promise<{
        removed: string[];
        skipped: string[];
    }>;
    listRuntimeStates(profileNames: string[]): Promise<ProfileRuntimeSnapshot[]>;
}

export const planProfileReconcile = (
    status: GatewayProfileStatus,
    runtime: ProfileRuntimeState
): { shouldStart: boolean; shouldStop: boolean } => {
    if (status === 'RUNNING' || status === 'PREOPEN' || status === 'PAUSED' || status === 'COMPLETED') {
        return {
            shouldStart: !(
                runtime.frontendRunning &&
                runtime.apiRunning &&
                runtime.daemonRunning &&
                runtime.auctionRunning &&
                runtime.battleSimRunning &&
                runtime.tournamentRunning
            ),
            shouldStop: false,
        };
    }
    return {
        shouldStart: false,
        shouldStop:
            runtime.frontendRunning ||
            runtime.apiRunning ||
            runtime.daemonRunning ||
            runtime.auctionRunning ||
            runtime.battleSimRunning ||
            runtime.tournamentRunning,
    };
};

type GatewayAdminActionStatus = 'REQUESTED' | 'APPLIED' | 'FAILED' | 'IGNORED';

interface GatewayAdminActionRecord {
    action?: string;
    requestedAt?: string;
    durationMinutes?: number | null;
    scheduledAt?: string | null;
    reason?: string | null;
    status?: GatewayAdminActionStatus | string | null;
    handledAt?: string | null;
    handler?: string | null;
    detail?: string | null;
    installOperationId?: string;
    install?: {
        scenarioId?: number;
        turnTermMinutes?: number;
        sync?: boolean;
        fiction?: number;
        extend?: boolean;
        blockGeneralCreate?: number;
        npcMode?: number;
        showImgLevel?: number;
        tournamentTrig?: boolean;
        joinMode?: string;
        autorunUser?: {
            limitMinutes?: number;
            options?: string[];
        } | null;
        adminUser?: {
            id?: string;
            username?: string;
            displayName?: string | null;
        };
        openAt?: string | null;
        preopenAt?: string | null;
        gitRef?: string | null;
    };
}

interface GatewayAdminActionResult {
    status: GatewayAdminActionStatus;
    detail?: string;
}

const OPERATION_LEASE_DURATION_MS = 10 * 60_000;
const OPERATION_HEARTBEAT_INTERVAL_MS = 60_000;

class OperationLeaseLostError extends Error {}

const normalizeMeta = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

export const buildTournamentRuntimeKeys = (profileName: string): string[] => [
    `sammo:${profileName}:tournament:state`,
    `sammo:${profileName}:tournament:participants`,
    `sammo:${profileName}:tournament:matches`,
    `sammo:${profileName}:tournament:betting`,
];

export const clearTournamentRuntimeKeys = async (
    redis: { del(keys: string[]): Promise<number> },
    profileName: string
): Promise<number> => redis.del(buildTournamentRuntimeKeys(profileName));

const buildServerId = (profileName: string, now: Date, installOperationId?: string): string => {
    const year = String(now.getFullYear()).slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const suffix = installOperationId
        ? createHash('sha256').update(installOperationId).digest('hex').slice(0, 16)
        : randomBytes(2).toString('hex');
    return `${profileName}_${year}${month}${day}_${suffix}`;
};

const readMetaNumber = (meta: Record<string, unknown>, key: string): number | null => {
    const raw = meta[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.floor(raw);
    }
    if (typeof raw === 'string') {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed);
        }
    }
    return null;
};

const normalizeStatus = (value: unknown): GatewayAdminActionStatus | null => {
    if (typeof value === 'string') {
        return value as GatewayAdminActionStatus;
    }
    return null;
};

const buildActionKey = (action: GatewayAdminActionRecord): string =>
    [action.action ?? '', action.requestedAt ?? '', action.scheduledAt ?? '', action.reason ?? ''].join('|');

const parseScenarioId = (value: string | number | null | undefined): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed);
        }
    }
    return null;
};

const parseDateTime = (value: unknown): Date | null => {
    if (typeof value !== 'string') {
        return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed;
};

const parseInstallOptions = (
    action: GatewayAdminActionRecord
): {
    installOptions: ScenarioInstallOptions | null;
    scenarioId: number | null;
    adminUser: AdminSeedUser | null;
    openAt: Date | null;
    preopenAt: Date | null;
} => {
    if (!isRecord(action.install)) {
        return { installOptions: null, scenarioId: null, adminUser: null, openAt: null, preopenAt: null };
    }

    const install = action.install;
    const scenarioId = parseScenarioId(install.scenarioId ?? null);
    const turnTermMinutes =
        typeof install.turnTermMinutes === 'number' && Number.isFinite(install.turnTermMinutes)
            ? Math.floor(install.turnTermMinutes)
            : undefined;
    const sync = typeof install.sync === 'boolean' ? install.sync : undefined;
    const fiction =
        typeof install.fiction === 'number' && Number.isFinite(install.fiction)
            ? Math.floor(install.fiction)
            : undefined;
    const extend = typeof install.extend === 'boolean' ? install.extend : undefined;
    const blockGeneralCreate =
        typeof install.blockGeneralCreate === 'number' && Number.isFinite(install.blockGeneralCreate)
            ? Math.floor(install.blockGeneralCreate)
            : undefined;
    const npcMode =
        typeof install.npcMode === 'number' && Number.isFinite(install.npcMode)
            ? Math.floor(install.npcMode)
            : undefined;
    const showImgLevel =
        typeof install.showImgLevel === 'number' && Number.isFinite(install.showImgLevel)
            ? Math.floor(install.showImgLevel)
            : undefined;
    const tournamentTrig = typeof install.tournamentTrig === 'boolean' ? install.tournamentTrig : undefined;
    const joinMode = typeof install.joinMode === 'string' ? install.joinMode : undefined;

    let autorunUser: ScenarioInstallOptions['autorunUser'];
    if (isRecord(install.autorunUser)) {
        const limitMinutes =
            typeof install.autorunUser.limitMinutes === 'number' && Number.isFinite(install.autorunUser.limitMinutes)
                ? Math.floor(install.autorunUser.limitMinutes)
                : 0;
        const optionsRaw = Array.isArray(install.autorunUser.options)
            ? install.autorunUser.options.filter((option) => typeof option === 'string')
            : [];
        const options = optionsRaw.reduce<Record<string, boolean>>((acc, option) => {
            acc[option] = true;
            return acc;
        }, {});
        if (limitMinutes > 0 && Object.keys(options).length > 0) {
            autorunUser = { limitMinutes, options };
        }
    }

    const openAt = parseDateTime(install.openAt ?? null);
    const preopenAt = parseDateTime(install.preopenAt ?? null);
    const adminUser =
        isRecord(install.adminUser) && typeof install.adminUser.id === 'string'
            ? {
                  id: install.adminUser.id,
                  username:
                      typeof install.adminUser.username === 'string'
                          ? install.adminUser.username
                          : install.adminUser.id,
                  displayName:
                      typeof install.adminUser.displayName === 'string' ? install.adminUser.displayName : undefined,
              }
            : null;

    const installOptions: ScenarioInstallOptions = {
        turnTermMinutes,
        sync,
        fiction,
        extend,
        blockGeneralCreate,
        npcMode,
        showImgLevel,
        tournamentTrig,
        joinMode: joinMode === 'full' || joinMode === 'onlyRandom' ? joinMode : undefined,
        autorunUser: autorunUser ?? null,
        preopenAt: preopenAt ?? null,
        installOperationId: action.installOperationId,
    };

    return {
        installOptions,
        scenarioId,
        adminUser,
        openAt,
        preopenAt,
    };
};

const buildProcessName = (
    profileName: string,
    role: 'frontend' | 'api' | 'daemon' | 'auction' | 'battle-sim' | 'tournament'
): string =>
    `sammo:${profileName}:${
        role === 'frontend'
            ? 'game-frontend'
            : role === 'api'
              ? 'game-api'
              : role === 'daemon'
                ? 'turn-daemon'
                : role === 'auction'
                  ? 'auction-worker'
                  : role === 'battle-sim'
                    ? 'battle-sim-worker'
                    : 'tournament-worker'
    }`;

const isMissingProcessError = (error: unknown): boolean =>
    error instanceof Error && /process or namespace not found/i.test(error.message);

const isRuntimeProcessActive = (status: string): boolean => {
    const normalized = status.toLowerCase();
    return normalized === 'online' || normalized === 'launching' || normalized === 'stopping';
};

const isPathInside = (candidate: string | undefined, root: string): boolean => {
    if (!candidate) {
        return false;
    }
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export const buildProcessDefinitions = (
    profile: GatewayProfileRecord,
    config: GatewayProcessConfig
): {
    frontend: { name: string; script: string; cwd: string; args: string[]; env: Record<string, string> };
    api: { name: string; script: string; cwd: string; env: Record<string, string> };
    daemon: { name: string; script: string; cwd: string; env: Record<string, string> };
    auction: { name: string; script: string; cwd: string; env: Record<string, string> };
    battleSim: { name: string; script: string; cwd: string; env: Record<string, string> };
    tournament: { name: string; script: string; cwd: string; env: Record<string, string> };
} => {
    const baseEnv = sanitizeManagedProcessEnv(config.baseEnv ?? {});
    const frontendName = buildProcessName(profile.profileName, 'frontend');
    const apiName = buildProcessName(profile.profileName, 'api');
    const daemonName = buildProcessName(profile.profileName, 'daemon');
    const auctionName = buildProcessName(profile.profileName, 'auction');
    const battleSimName = buildProcessName(profile.profileName, 'battle-sim');
    const tournamentName = buildProcessName(profile.profileName, 'tournament');
    const runtimeWorkspace = profile.buildWorkspace ?? config.workspaceRoot;
    const frontendCwd = path.join(runtimeWorkspace, 'app', 'game-frontend');
    const frontendOutDir = buildProfileFrontendOutDir(runtimeWorkspace, profile.profileName);
    const frontendScript = path.join(frontendCwd, 'node_modules', 'vite', 'bin', 'vite.js');
    const apiCwd = path.join(runtimeWorkspace, 'app', 'game-api');
    const daemonCwd = path.join(runtimeWorkspace, 'app', 'game-engine');
    const apiScript = path.join(apiCwd, 'dist', 'index.js');
    const daemonScript = path.join(daemonCwd, 'dist', 'index.js');
    const apiEnv = {
        ...baseEnv,
        GAME_API_ROLE: 'server',
        PROFILE: profile.profile,
        SCENARIO: profile.scenario,
        GAME_PROFILE_NAME: profile.profileName,
        GAME_API_PORT: String(profile.apiPort),
        GAME_TRPC_PATH: `/${profile.profile}/api/trpc`,
        GAME_API_EVENTS_PATH: `/${profile.profile}/api/events`,
        GAME_UPLOAD_PATH: `/${profile.profile}/api/uploads`,
        GATEWAY_REDIS_PREFIX: config.redisKeyPrefix,
        GAME_TOKEN_SECRET: config.gameTokenSecret,
        GATEWAY_INTERNAL_API_URL: config.gatewayInternalApiUrl,
    };
    const daemonEnv = {
        ...baseEnv,
        GAME_ENGINE_ROLE: 'turn-daemon',
        TURN_PROFILE: profile.profile,
        PROFILE: profile.profile,
        SCENARIO: profile.scenario,
        TURN_PROFILE_NAME: profile.profileName,
    };
    return {
        frontend: {
            name: frontendName,
            script: frontendScript,
            cwd: frontendCwd,
            args: ['preview', '--host', '0.0.0.0', '--port', String(profile.apiPort - 1), '--outDir', frontendOutDir],
            env: {
                ...baseEnv,
                VITE_APP_BASE_PATH: `/${profile.profile}`,
            },
        },
        api: {
            name: apiName,
            script: apiScript,
            cwd: apiCwd,
            env: apiEnv,
        },
        daemon: {
            name: daemonName,
            script: daemonScript,
            cwd: daemonCwd,
            env: daemonEnv,
        },
        auction: {
            name: auctionName,
            script: apiScript,
            cwd: apiCwd,
            env: {
                ...apiEnv,
                GAME_API_ROLE: 'auction-worker',
            },
        },
        battleSim: {
            name: battleSimName,
            script: apiScript,
            cwd: apiCwd,
            env: {
                ...apiEnv,
                GAME_API_ROLE: 'battle-sim-worker',
            },
        },
        tournament: {
            name: tournamentName,
            script: apiScript,
            cwd: apiCwd,
            env: {
                ...apiEnv,
                GAME_API_ROLE: 'tournament-worker',
            },
        },
    };
};

const sanitizeArtifactName = (value: string): string => value.replace(/[^0-9A-Za-z._-]+/g, '_');

export const buildProfileFrontendOutDir = (workspaceRoot: string, profileName: string): string =>
    path.join(workspaceRoot, '.release-dist', sanitizeArtifactName(profileName), 'game-frontend');

export const buildProfileFrontendCommands = (
    workspaceRoot: string,
    profile: Pick<GatewayProfileRecord, 'profileName' | 'profile' | 'apiPort'>,
    env?: Record<string, string>
): BuildCommand[] => {
    const buildEnv = {
        ...(env ?? {}),
        VITE_APP_BASE_PATH: `/${profile.profile}`,
        VITE_GAME_API_URL: `/${profile.profile}/api/trpc`,
        VITE_GAME_SSE_URL: `/${profile.profile}/api/events`,
    };
    const outDir = buildProfileFrontendOutDir(workspaceRoot, profile.profileName);
    return [
        {
            command: 'pnpm',
            args: ['--filter', '@sammo-ts/game-frontend', 'exec', 'vue-tsc', '--noEmit'],
            cwd: workspaceRoot,
            env: buildEnv,
        },
        {
            command: 'pnpm',
            args: ['--filter', '@sammo-ts/game-frontend', 'exec', 'vite', 'build', '--outDir', outDir],
            cwd: workspaceRoot,
            env: buildEnv,
        },
    ];
};

export const buildWorkspaceCommands = (
    workspaceRoot: string,
    needsInstall: boolean,
    env?: Record<string, string>
): BuildCommand[] => {
    const commands: BuildCommand[] = [];
    if (needsInstall) {
        commands.push({
            command: 'pnpm',
            args: ['install', '--frozen-lockfile'],
            cwd: workspaceRoot,
            env,
        });
    }
    const buildSteps: Array<[filter: string, script: string]> = [
        ['@sammo-ts/common', 'build'],
        ['@sammo-ts/infra', 'prisma:generate'],
        ['@sammo-ts/infra', 'build'],
        ['@sammo-ts/logic', 'build'],
        ['@sammo-ts/game-api', 'build'],
        ['@sammo-ts/game-engine', 'build'],
        ['@sammo-ts/gateway-api', 'build'],
    ];
    for (const [filter, script] of buildSteps) {
        commands.push({
            command: 'pnpm',
            args: ['--filter', filter, script],
            cwd: workspaceRoot,
            env,
        });
    }
    return commands;
};

export const buildProfileMigrationCommand = (
    workspaceRoot: string,
    profileDatabaseUrl: string,
    env?: Record<string, string>
): BuildCommand => ({
    command: 'pnpm',
    args: ['--filter', '@sammo-ts/infra', 'prisma:migrate:deploy:game'],
    cwd: workspaceRoot,
    env: { ...(env ?? {}), DATABASE_URL: profileDatabaseUrl },
});

const mapRuntimeStates = (profileNames: string[], processNames: Map<string, boolean>): ProfileRuntimeSnapshot[] =>
    profileNames.map((profileName) => {
        const frontendName = buildProcessName(profileName, 'frontend');
        const apiName = buildProcessName(profileName, 'api');
        const daemonName = buildProcessName(profileName, 'daemon');
        const auctionName = buildProcessName(profileName, 'auction');
        const battleSimName = buildProcessName(profileName, 'battle-sim');
        const tournamentName = buildProcessName(profileName, 'tournament');
        return {
            profileName,
            frontendRunning: processNames.get(frontendName) ?? false,
            apiRunning: processNames.get(apiName) ?? false,
            daemonRunning: processNames.get(daemonName) ?? false,
            auctionRunning: processNames.get(auctionName) ?? false,
            battleSimRunning: processNames.get(battleSimName) ?? false,
            tournamentRunning: processNames.get(tournamentName) ?? false,
        };
    });

export class GatewayOrchestrator implements GatewayOrchestratorHandle {
    private readonly repository: GatewayProfileRepository;
    private readonly processManager: ProcessManager;
    private readonly buildRunner: BuildRunner;
    private readonly workspaceManager: GitWorkspaceManager;
    private readonly processConfig: GatewayProcessConfig;
    private readonly reconcileIntervalMs: number;
    private readonly scheduleIntervalMs: number;
    private readonly buildIntervalMs: number;
    private readonly adminActionIntervalMs: number;
    private readonly profileReadinessTimeoutMs: number;
    private readonly now: () => Date;
    private readonly fetchImpl: typeof fetch;
    private readonly clearTournamentRuntimeState: (profileName: string) => Promise<void>;
    private reconcileTimer?: NodeJS.Timeout;
    private scheduleTimer?: NodeJS.Timeout;
    private buildTimer?: NodeJS.Timeout;
    private adminActionTimer?: NodeJS.Timeout;
    private reconcileInFlight = false;
    private scheduleInFlight = false;
    private buildInFlight = false;
    private adminActionInFlight = false;
    private operationInFlight = false;
    private readonly resetInFlight = new Set<string>();
    private readonly operationLeaseOwner = randomUUID();
    private readonly inFlightTasks = new Set<Promise<unknown>>();
    private stopping = false;
    private stopPromise?: Promise<void>;

    constructor(options: GatewayOrchestratorOptions) {
        this.repository = options.repository;
        this.processManager = options.processManager;
        this.buildRunner = options.buildRunner;
        this.workspaceManager = options.workspaceManager;
        this.processConfig = options.processConfig;
        this.reconcileIntervalMs = options.reconcileIntervalMs;
        this.scheduleIntervalMs = options.scheduleIntervalMs;
        this.buildIntervalMs = options.buildIntervalMs;
        this.adminActionIntervalMs = options.adminActionIntervalMs;
        this.profileReadinessTimeoutMs = options.profileReadinessTimeoutMs ?? 30_000;
        this.now = options.now ?? (() => new Date());
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.clearTournamentRuntimeState =
            options.clearTournamentRuntimeState ??
            ((profileName) => this.clearTournamentRuntimeStateFromRedis(profileName));
    }

    start(): void {
        this.stopping = false;
        this.trackTask(this.reconcileNow());
        this.trackTask(this.runOperationsNow());
        this.trackTask(this.runAdminActionsNow());
        this.reconcileTimer = setInterval(() => this.trackTask(this.reconcileNow()), this.reconcileIntervalMs);
        this.scheduleTimer = setInterval(() => this.trackTask(this.runScheduleNow()), this.scheduleIntervalMs);
        this.buildTimer = setInterval(() => this.trackTask(this.runBuildQueueNow()), this.buildIntervalMs);
        this.adminActionTimer = setInterval(() => {
            this.trackTask(this.runOperationsNow());
            this.trackTask(this.runAdminActionsNow());
        }, this.adminActionIntervalMs);
    }

    async stop(): Promise<void> {
        if (this.stopPromise) {
            return this.stopPromise;
        }
        this.stopPromise = this.stopAndDrain();
        return this.stopPromise;
    }

    private async stopAndDrain(): Promise<void> {
        this.stopping = true;
        if (this.reconcileTimer) {
            clearInterval(this.reconcileTimer);
        }
        if (this.scheduleTimer) {
            clearInterval(this.scheduleTimer);
        }
        if (this.buildTimer) {
            clearInterval(this.buildTimer);
        }
        if (this.adminActionTimer) {
            clearInterval(this.adminActionTimer);
        }
        await Promise.allSettled([...this.inFlightTasks]);
    }

    private trackTask(task: Promise<unknown>): void {
        this.inFlightTasks.add(task);
        void task
            .catch((error) => {
                console.error('[gateway-orchestrator] scheduled task failed', error);
            })
            .finally(() => this.inFlightTasks.delete(task));
    }

    async listRuntimeStates(profileNames: string[]): Promise<ProfileRuntimeSnapshot[]> {
        const processStates = await this.loadProcessStatusMap();
        return mapRuntimeStates(profileNames, processStates);
    }

    async reconcileNow(): Promise<void> {
        if (this.stopping || this.reconcileInFlight) {
            return;
        }
        this.reconcileInFlight = true;
        try {
            const profiles = await this.repository.listProfiles();
            if (!profiles.length) {
                return;
            }
            const activeOperationProfiles = new Set(
                (await this.repository.listActiveOperationProfileNames?.(this.now())) ?? []
            );
            const processStates = await this.loadProcessStatusMap();
            for (const profile of profiles) {
                if (this.resetInFlight.has(profile.profileName) || activeOperationProfiles.has(profile.profileName)) {
                    continue;
                }
                const runtime = mapRuntimeStates([profile.profileName], processStates)[0];
                const plan = planProfileReconcile(profile.status, runtime);
                if (plan.shouldStart) {
                    await this.startProfile(profile);
                } else if (plan.shouldStop) {
                    await this.stopProfile(profile);
                }
            }
        } finally {
            this.reconcileInFlight = false;
        }
    }

    async runScheduleNow(): Promise<void> {
        if (this.stopping || this.scheduleInFlight) {
            return;
        }
        this.scheduleInFlight = true;
        try {
            const now = this.now();
            const due = await this.repository.listReservedToStart(now);
            for (const profile of due) {
                if (!profile.preopenAt || !profile.openAt) {
                    await this.repository.updateLastError(
                        profile.profileName,
                        'Reserved profile is missing preopen/open schedule.'
                    );
                    continue;
                }
                if (!profile.buildCommitSha) {
                    await this.repository.updateLastError(
                        profile.profileName,
                        'Reserved profile is missing build commit SHA.'
                    );
                    continue;
                }
                const queued = profile.buildStatus === 'QUEUED' || profile.buildStatus === 'RUNNING';
                if (!queued) {
                    await this.repository.updateBuildStatus(profile.profileName, 'QUEUED', {
                        requestedAt: now.toISOString(),
                        error: null,
                        commitSha: profile.buildCommitSha,
                    });
                }
            }
            const profiles = await this.repository.listProfiles();
            for (const profile of profiles) {
                if (profile.status === 'PREOPEN' && profile.openAt && new Date(profile.openAt) <= now) {
                    await this.repository.updateStatus(profile.profileName, 'RUNNING', {
                        preopenAt: profile.preopenAt ?? null,
                        openAt: profile.openAt ?? null,
                    });
                }
            }
        } finally {
            this.scheduleInFlight = false;
        }
    }

    async runBuildQueueNow(): Promise<void> {
        if (this.stopping || this.buildInFlight) {
            return;
        }
        this.buildInFlight = true;
        try {
            const queued = await this.repository.findQueuedBuild();
            if (!queued) {
                return;
            }
            if (!queued.buildCommitSha) {
                await this.repository.updateBuildStatus(queued.profileName, 'FAILED', {
                    completedAt: this.now().toISOString(),
                    error: 'Missing build commit SHA.',
                });
                return;
            }
            const startedAt = this.now().toISOString();
            await this.repository.updateBuildStatus(queued.profileName, 'RUNNING', {
                startedAt,
                error: null,
            });
            const { result, workspace } = await this.runBuildCommands(queued.buildCommitSha, queued);
            const completedAt = this.now().toISOString();
            if (result.ok) {
                await this.repository.updateWorkspaceUsage(
                    queued.profileName,
                    workspace.root,
                    this.now().toISOString()
                );
                await this.repository.updateBuildStatus(queued.profileName, 'SUCCEEDED', {
                    completedAt,
                    error: null,
                });
                if (queued.status === 'RESERVED') {
                    await this.repository.updateStatus(
                        queued.profileName,
                        queued.openAt && new Date(queued.openAt) <= this.now() ? 'RUNNING' : 'PREOPEN',
                        {
                            preopenAt: queued.preopenAt ?? null,
                            openAt: queued.openAt ?? null,
                        }
                    );
                } else if (queued.status === 'PREOPEN' && queued.openAt) {
                    if (new Date(queued.openAt) <= this.now()) {
                        await this.repository.updateStatus(queued.profileName, 'RUNNING', {
                            preopenAt: queued.preopenAt ?? null,
                            openAt: queued.openAt ?? null,
                        });
                    }
                }
            } else {
                await this.repository.updateBuildStatus(queued.profileName, 'FAILED', {
                    completedAt,
                    error: result.output.slice(-4000),
                });
            }
        } finally {
            this.buildInFlight = false;
        }
    }

    async runOperationsNow(): Promise<void> {
        if (this.stopping || this.operationInFlight || this.buildInFlight) {
            return;
        }
        this.operationInFlight = true;
        try {
            const operation = await this.repository.claimNextOperation(this.now(), {
                ownerId: this.operationLeaseOwner,
                durationMs: OPERATION_LEASE_DURATION_MS,
            });
            if (!operation) {
                return;
            }
            const heartbeatTimer = this.repository.renewOperationLease
                ? setInterval(() => {
                      void this.repository
                          .renewOperationLease?.(
                              operation.id,
                              this.operationLeaseOwner,
                              this.now(),
                              OPERATION_LEASE_DURATION_MS
                          )
                          .catch((error) => {
                              console.error('[gateway-orchestrator] operation heartbeat failed', error);
                          });
                  }, OPERATION_HEARTBEAT_INTERVAL_MS)
                : undefined;
            try {
                await this.handleOperation(operation);
            } finally {
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                }
            }
        } finally {
            this.operationInFlight = false;
        }
    }

    private async assertOperationLease(operationId: string): Promise<void> {
        if (!this.repository.renewOperationLease) {
            return;
        }
        const renewed = await this.repository.renewOperationLease(
            operationId,
            this.operationLeaseOwner,
            this.now(),
            OPERATION_LEASE_DURATION_MS
        );
        if (!renewed) {
            throw new OperationLeaseLostError(`Operation lease lost: ${operationId}`);
        }
    }

    private async handleOperation(operation: GatewayOperationRecord): Promise<void> {
        const assertLease = () => this.assertOperationLease(operation.id);
        const profile = await this.repository.getProfile(operation.profileName);
        if (!profile) {
            await this.repository.completeOperation(
                operation.id,
                'FAILED',
                {
                    error: 'Profile not found.',
                },
                this.operationLeaseOwner
            );
            return;
        }
        const updateOperationProfile = async (
            patch: GatewayClaimedProfileUpdate,
            fallback: () => Promise<GatewayProfileRecord | null>
        ): Promise<GatewayProfileRecord | null> => {
            if (this.repository.updateProfileForOperation) {
                const updated = await this.repository.updateProfileForOperation(
                    operation.id,
                    this.operationLeaseOwner,
                    profile.profileName,
                    patch
                );
                if (!updated) {
                    throw new OperationLeaseLostError(`Operation lease lost while updating profile: ${operation.id}`);
                }
                return updated;
            }
            await assertLease();
            return fallback();
        };
        let resolvedCommitSha: string | undefined;
        try {
            if (operation.type === 'START') {
                const updated = await updateOperationProfile(
                    {
                        status: 'RUNNING',
                        preopenAt: null,
                        openAt: null,
                        scheduledStartAt: null,
                    },
                    () =>
                        this.repository.updateStatus(profile.profileName, 'RUNNING', {
                            preopenAt: null,
                            openAt: null,
                            scheduledStartAt: null,
                        })
                );
                const started = await this.startProfile(updated ?? profile, assertLease);
                if (!started) {
                    await updateOperationProfile({ status: 'STOPPED' }, () =>
                        this.repository.updateStatus(profile.profileName, 'STOPPED')
                    );
                    throw new Error('Failed to start profile processes.');
                }
                await updateOperationProfile({ lastError: null }, async () => {
                    await this.repository.updateLastError(profile.profileName, null);
                    return this.repository.getProfile(profile.profileName);
                });
                await this.repository.completeOperation(
                    operation.id,
                    'SUCCEEDED',
                    { error: null },
                    this.operationLeaseOwner
                );
                return;
            }
            if (operation.type === 'STOP') {
                await updateOperationProfile({ status: 'STOPPED' }, () =>
                    this.repository.updateStatus(profile.profileName, 'STOPPED')
                );
                await this.stopProfile(profile, assertLease);
                await this.repository.completeOperation(
                    operation.id,
                    'SUCCEEDED',
                    { error: null },
                    this.operationLeaseOwner
                );
                return;
            }

            if (!operation.sourceMode || !operation.sourceRef) {
                throw new Error('Reset source mode and ref are required.');
            }
            const commitSha =
                operation.resolvedCommitSha ??
                (await this.workspaceManager.resolveCommit(operation.sourceMode, operation.sourceRef));
            resolvedCommitSha = commitSha;
            if (!operation.resolvedCommitSha && this.repository.pinOperationResolvedCommit) {
                const pinned = await this.repository.pinOperationResolvedCommit(
                    operation.id,
                    this.operationLeaseOwner,
                    commitSha
                );
                if (!pinned) {
                    throw new OperationLeaseLostError(`Operation lease lost while pinning commit: ${operation.id}`);
                }
            }
            await assertLease();
            if (operation.type === 'DEPLOY') {
                const result = await this.handleProfileDeploy(profile, commitSha, assertLease, operation.id);
                if (!result.ok) {
                    throw new Error(result.detail);
                }
                await this.repository.completeOperation(
                    operation.id,
                    'SUCCEEDED',
                    { resolvedCommitSha: commitSha, error: null },
                    this.operationLeaseOwner
                );
                return;
            }
            const payload = normalizeMeta(operation.payload);
            const install = isRecord(payload.install) ? payload.install : {};
            const installOperationId =
                typeof payload.installOperationId === 'string' ? payload.installOperationId : operation.id;
            const resetAction: GatewayAdminActionRecord = {
                action: operation.scheduledAt ? 'RESET_SCHEDULED' : 'RESET_NOW',
                requestedAt: operation.createdAt,
                scheduledAt: operation.scheduledAt ?? null,
                reason: operation.reason ?? null,
                installOperationId,
                install,
            };
            const result = await this.handleResetAction(profile, resetAction, commitSha, assertLease, operation.id);
            if (result.status === 'REQUESTED') {
                const retryAt = new Date(this.now().getTime() + this.adminActionIntervalMs).toISOString();
                await this.repository.requeueOperation(operation.id, result.detail, retryAt, this.operationLeaseOwner);
                return;
            }
            if (result.status !== 'APPLIED') {
                throw new Error(result.detail ?? 'Reset failed.');
            }
            await this.repository.completeOperation(
                operation.id,
                'SUCCEEDED',
                {
                    resolvedCommitSha: commitSha,
                    error: null,
                },
                this.operationLeaseOwner
            );
        } catch (error) {
            if (
                error instanceof OperationLeaseLostError ||
                (error instanceof Error && error.message.startsWith('Operation lease lost before'))
            ) {
                return;
            }
            const detail = error instanceof Error ? error.message : String(error);
            try {
                await this.repository.completeOperation(
                    operation.id,
                    'FAILED',
                    {
                        ...(resolvedCommitSha ? { resolvedCommitSha } : {}),
                        error: detail,
                    },
                    this.operationLeaseOwner
                );
            } catch (completionError) {
                if (
                    completionError instanceof Error &&
                    completionError.message.startsWith('Operation lease lost before')
                ) {
                    return;
                }
                throw completionError;
            }
        }
    }

    private async handleProfileDeploy(
        profile: GatewayProfileRecord,
        commitSha: string,
        assertLease: () => Promise<void>,
        operationId: string
    ): Promise<{ ok: true } | { ok: false; detail: string }> {
        if (this.buildInFlight) {
            return { ok: false, detail: 'build already in progress' };
        }
        this.buildInFlight = true;
        const shouldRun = ['RUNNING', 'PREOPEN', 'PAUSED', 'COMPLETED'].includes(profile.status);
        const updateClaimedProfile = async (patch: GatewayClaimedProfileUpdate): Promise<GatewayProfileRecord> => {
            if (!this.repository.updateProfileForOperation) {
                throw new Error('Profile deploy requires lease-fenced profile updates.');
            }
            const updated = await this.repository.updateProfileForOperation(
                operationId,
                this.operationLeaseOwner,
                profile.profileName,
                patch
            );
            if (!updated) {
                throw new OperationLeaseLostError(`Operation lease lost while deploying profile: ${operationId}`);
            }
            return updated;
        };
        let oldRuntimeStopped = false;
        try {
            const startedAt = this.now().toISOString();
            await updateClaimedProfile({
                buildStatus: 'RUNNING',
                buildRequestedAt: startedAt,
                buildStartedAt: startedAt,
                buildError: null,
            });
            const workspace = await this.workspaceManager.prepare(commitSha);
            const manifest = await readReleaseManifest(workspace.root);
            assertReleaseComponents(manifest, ['game-api', 'game-engine', 'game-frontend']);
            const commands = [
                ...buildWorkspaceCommands(workspace.root, workspace.needsInstall, this.processConfig.baseEnv),
                ...buildProfileFrontendCommands(workspace.root, profile, this.processConfig.baseEnv),
            ];
            const result = await this.buildRunner.run(commands);
            await assertLease();
            if (!result.ok) {
                const detail = result.output.slice(-4000) || 'selected workspace build failed';
                await updateClaimedProfile({
                    buildStatus: 'FAILED',
                    buildCompletedAt: this.now().toISOString(),
                    buildError: detail,
                });
                return { ok: false, detail };
            }

            await this.stopProfile(profile, assertLease);
            oldRuntimeStopped = true;
            const profileDatabaseUrl = this.resolveProfileDatabaseUrl(profile);
            const migration = await this.runProfileMigration(workspace.root, profileDatabaseUrl);
            await assertLease();
            if (!migration.ok) {
                const detail = migration.output.slice(-4000) || 'profile database migration failed';
                if (shouldRun) {
                    await this.startProfile(profile, assertLease);
                    oldRuntimeStopped = false;
                }
                await updateClaimedProfile({
                    buildStatus: 'FAILED',
                    buildCompletedAt: this.now().toISOString(),
                    buildError: detail,
                });
                return { ok: false, detail };
            }

            const completedAt = this.now().toISOString();
            const candidate: GatewayProfileRecord = {
                ...profile,
                buildStatus: 'SUCCEEDED',
                buildCommitSha: commitSha,
                buildWorkspace: workspace.root,
                buildLastUsedAt: completedAt,
                buildCompletedAt: completedAt,
                buildError: undefined,
            };
            if (shouldRun) {
                const started = await this.startProfile(candidate, assertLease);
                const ready = started && (await this.waitForProfileReadiness(candidate, assertLease));
                if (!ready) {
                    if (started) {
                        await this.stopProfile(candidate, assertLease);
                    }
                    const rollbackStarted =
                        (await this.startProfile(profile, assertLease)) &&
                        (await this.waitForProfileReadiness(profile, assertLease));
                    oldRuntimeStopped = !rollbackStarted;
                    const detail = rollbackStarted
                        ? 'new profile release failed readiness; previous runtime restored'
                        : 'new profile release failed and previous runtime could not be restored';
                    await updateClaimedProfile({
                        buildStatus: 'FAILED',
                        buildCompletedAt: completedAt,
                        buildError: detail,
                        lastError: detail,
                        status: rollbackStarted ? profile.status : 'STOPPED',
                    });
                    return { ok: false, detail };
                }
            }
            await assertLease();
            await updateClaimedProfile({
                buildStatus: 'SUCCEEDED',
                buildCommitSha: commitSha,
                buildWorkspace: workspace.root,
                buildLastUsedAt: completedAt,
                buildCompletedAt: completedAt,
                buildError: null,
                lastError: null,
            });
            oldRuntimeStopped = false;
            return { ok: true };
        } catch (error) {
            if (error instanceof OperationLeaseLostError) {
                throw error;
            }
            const detail = error instanceof Error ? error.message : String(error);
            if (oldRuntimeStopped && shouldRun) {
                try {
                    await this.startProfile(profile, assertLease);
                } catch {
                    // The original error remains authoritative; reconciliation records the stopped runtime.
                }
            }
            await updateClaimedProfile({
                buildStatus: 'FAILED',
                buildCompletedAt: this.now().toISOString(),
                buildError: detail,
                lastError: detail,
            });
            return { ok: false, detail };
        } finally {
            this.buildInFlight = false;
        }
    }

    private async runAdminActionsNow(): Promise<void> {
        if (this.stopping || this.adminActionInFlight) {
            return;
        }
        this.adminActionInFlight = true;
        try {
            const profiles = await this.repository.listProfiles();
            for (const profile of profiles) {
                await this.handleProfileAdminActions(profile);
            }
        } finally {
            this.adminActionInFlight = false;
        }
    }

    private async handleProfileAdminActions(profile: GatewayProfileRecord): Promise<void> {
        const meta = normalizeMeta(profile.meta);
        const rawActions = Array.isArray(meta.adminActions) ? meta.adminActions : [];
        if (!rawActions.length) {
            return;
        }
        const pending = rawActions.filter((entry): entry is GatewayAdminActionRecord => {
            if (!isRecord(entry)) {
                return false;
            }
            if (!entry.action || typeof entry.action !== 'string') {
                return false;
            }
            const status = normalizeStatus(entry.status) ?? 'REQUESTED';
            return status === 'REQUESTED';
        });
        if (!pending.length) {
            return;
        }

        const updates = new Map<string, { status: GatewayAdminActionStatus; detail?: string; handledAt: string }>();

        for (const action of pending) {
            if (action.action !== 'RESET_NOW' && action.action !== 'RESET_SCHEDULED') {
                continue;
            }
            const key = buildActionKey(action);
            const result = await this.handleResetAction(profile, action);
            if (result.status !== 'REQUESTED') {
                updates.set(key, {
                    status: result.status,
                    detail: result.detail,
                    handledAt: this.now().toISOString(),
                });
            }
        }

        if (!updates.size) {
            return;
        }

        const nextActions = rawActions.map((entry) => {
            if (!isRecord(entry)) {
                return entry;
            }
            const action = entry as GatewayAdminActionRecord;
            const key = buildActionKey(action);
            const update = updates.get(key);
            if (!update) {
                return entry;
            }
            return {
                ...action,
                status: update.status,
                handledAt: update.handledAt,
                handler: action.handler ?? 'orchestrator',
                detail: update.detail ?? action.detail ?? null,
            };
        });

        await this.repository.updateMeta(profile.profileName, {
            ...meta,
            adminActions: nextActions,
            adminActionsUpdatedAt: this.now().toISOString(),
        });
    }

    private async handleResetAction(
        profile: GatewayProfileRecord,
        action: GatewayAdminActionRecord,
        commitShaOverride?: string,
        assertLease?: () => Promise<void>,
        operationId?: string
    ): Promise<GatewayAdminActionResult> {
        // 리셋 요청을 빌드+재기동 흐름으로 처리한다.
        if (this.resetInFlight.has(profile.profileName)) {
            return { status: 'REQUESTED', detail: 'reset already in progress' };
        }
        if (action.action === 'RESET_SCHEDULED') {
            if (!action.scheduledAt) {
                return { status: 'FAILED', detail: 'scheduledAt is required' };
            }
            const scheduledAt = new Date(action.scheduledAt);
            if (Number.isNaN(scheduledAt.getTime())) {
                return { status: 'FAILED', detail: 'scheduledAt is invalid' };
            }
            if (scheduledAt.getTime() > this.now().getTime()) {
                return { status: 'REQUESTED', detail: 'waiting for schedule' };
            }
        }

        const commitSha = commitShaOverride ?? profile.buildCommitSha;
        if (!commitSha) {
            return { status: 'FAILED', detail: 'buildCommitSha is missing' };
        }
        if (this.buildInFlight) {
            return { status: 'REQUESTED', detail: 'build already in progress' };
        }
        this.buildInFlight = true;
        this.resetInFlight.add(profile.profileName);
        let releasePrepared = false;
        const updateClaimedProfile = async (
            patch: GatewayClaimedProfileUpdate,
            fallback: () => Promise<GatewayProfileRecord | null>
        ): Promise<GatewayProfileRecord | null> => {
            if (operationId && this.repository.updateProfileForOperation) {
                const updated = await this.repository.updateProfileForOperation(
                    operationId,
                    this.operationLeaseOwner,
                    profile.profileName,
                    patch
                );
                if (!updated) {
                    throw new OperationLeaseLostError(`Operation lease lost while updating profile: ${operationId}`);
                }
                return updated;
            }
            await assertLease?.();
            return fallback();
        };
        try {
            const {
                installOptions,
                scenarioId: installScenarioId,
                adminUser,
                openAt,
                preopenAt,
            } = parseInstallOptions(action);
            const tickOverride =
                installOptions?.turnTermMinutes !== undefined ? installOptions.turnTermMinutes * 60 : undefined;
            const scenarioId = installScenarioId ?? parseScenarioId(profile.scenario);
            if (!scenarioId) {
                return { status: 'FAILED', detail: 'scenarioId is missing' };
            }
            const profileDatabaseUrl = this.resolveProfileDatabaseUrl(profile);
            const seedTime =
                openAt ??
                (action.scheduledAt && action.action === 'RESET_SCHEDULED'
                    ? new Date(action.scheduledAt)
                    : (parseDateTime(action.requestedAt) ?? this.now()));
            const startedAt = this.now().toISOString();
            await updateClaimedProfile(
                {
                    buildStatus: 'RUNNING',
                    buildRequestedAt: startedAt,
                    buildStartedAt: startedAt,
                    buildError: null,
                    buildCommitSha: commitSha,
                },
                () =>
                    this.repository.updateBuildStatus(profile.profileName, 'RUNNING', {
                        requestedAt: startedAt,
                        startedAt,
                        error: null,
                        commitSha,
                    })
            );
            const { result, workspace } = await this.runBuildCommands(commitSha, profile);
            await assertLease?.();
            if (!result.ok) {
                const completedAt = this.now().toISOString();
                await updateClaimedProfile(
                    {
                        buildStatus: 'FAILED',
                        buildCompletedAt: completedAt,
                        buildError: result.output.slice(-4000),
                    },
                    () =>
                        this.repository.updateBuildStatus(profile.profileName, 'FAILED', {
                            completedAt,
                            error: result.output.slice(-4000),
                        })
                );
                return { status: 'FAILED', detail: 'selected workspace build failed' };
            }
            await this.assertProfileSeedCli(workspace.root);
            // A newly provisioned profile schema has no world_state row (or table) yet.
            // Apply the selected release's migrations before reading optional prior-season
            // metadata; existing profiles still expose the same season/tick values afterward.
            const migrationResult = await this.runProfileMigration(workspace.root, profileDatabaseUrl);
            await assertLease?.();
            if (!migrationResult.ok) {
                const completedAt = this.now().toISOString();
                await updateClaimedProfile(
                    {
                        buildStatus: 'FAILED',
                        buildCompletedAt: completedAt,
                        buildError: migrationResult.output.slice(-4000),
                    },
                    () =>
                        this.repository.updateBuildStatus(profile.profileName, 'FAILED', {
                            completedAt,
                            error: migrationResult.output.slice(-4000),
                        })
                );
                return { status: 'FAILED', detail: 'profile database migration failed' };
            }
            const seedInfo = await this.resolveResetSeedInfo(
                profile,
                {
                    scenarioId,
                    tickSeconds: tickOverride,
                },
                profileDatabaseUrl
            );
            const profileMeta = normalizeMeta(profile.meta);
            const nextSeasonIdx = readMetaNumber(profileMeta, 'nextSeasonIdx');
            const baseSeason = readMetaNumber(normalizeMeta(seedInfo.meta), 'season');
            const season = nextSeasonIdx ?? baseSeason ?? 1;
            await updateClaimedProfile({ status: 'STOPPED' }, () =>
                this.repository.updateStatus(profile.profileName, 'STOPPED')
            );
            await this.stopProfile(profile, assertLease);
            await assertLease?.();
            const serverId = buildServerId(profile.profileName, seedTime, installOptions?.installOperationId);
            const seedResult = await this.runSelectedProfileSeed({
                workspaceRoot: workspace.root,
                databaseUrl: seedInfo.databaseUrl,
                scenarioId,
                tickSeconds: seedInfo.tickSeconds,
                now: seedTime,
                installOptions: {
                    ...(installOptions ?? {}),
                    season,
                    serverId,
                    installCommitSha: commitSha,
                },
                adminUser,
            });
            await assertLease?.();
            if (!seedResult.ok) {
                throw new Error(`Selected profile seed failed: ${seedResult.output.slice(-4000)}`);
            }
            await this.clearTournamentRuntimeState(profile.profileName);
            await assertLease?.();
            const completedAt = this.now().toISOString();
            const now = this.now();
            const shouldPreopen = openAt ? openAt.getTime() > now.getTime() : false;
            const desiredStatus = shouldPreopen ? 'PREOPEN' : 'RUNNING';
            const publishedProfile = await updateClaimedProfile(
                {
                    scenario: String(scenarioId),
                    status: desiredStatus,
                    buildStatus: 'SUCCEEDED',
                    buildWorkspace: workspace.root,
                    buildLastUsedAt: completedAt,
                    buildCompletedAt: completedAt,
                    buildError: null,
                    preopenAt: preopenAt ? preopenAt.toISOString() : openAt ? openAt.toISOString() : null,
                    openAt: openAt ? openAt.toISOString() : null,
                    scheduledStartAt: action.scheduledAt ?? null,
                },
                async () => {
                    await this.repository.updateWorkspaceUsage(profile.profileName, workspace.root, completedAt);
                    await this.repository.updateBuildStatus(profile.profileName, 'SUCCEEDED', {
                        completedAt,
                        error: null,
                    });
                    if (String(scenarioId) !== profile.scenario) {
                        await this.repository.updateScenario(profile.profileName, String(scenarioId));
                    }
                    return this.repository.updateStatus(profile.profileName, desiredStatus, {
                        preopenAt: preopenAt ? preopenAt.toISOString() : openAt ? openAt.toISOString() : null,
                        openAt: openAt ? openAt.toISOString() : null,
                        scheduledStartAt: action.scheduledAt ?? null,
                    });
                }
            );
            releasePrepared = true;
            const builtProfile = publishedProfile ?? {
                ...profile,
                scenario: String(scenarioId),
                status: desiredStatus,
                buildWorkspace: workspace.root,
            };
            const started = await this.startProfile(builtProfile, assertLease);
            const ready = started && (await this.waitForProfileReadiness(builtProfile, assertLease));
            if (!ready) {
                if (started) {
                    await this.stopProfile(builtProfile, assertLease);
                }
                const detail = started
                    ? 'reset completed but profile processes failed readiness'
                    : 'reset completed but profile processes failed to start';
                await updateClaimedProfile({ status: 'STOPPED', lastError: detail }, () =>
                    this.repository.updateStatus(profile.profileName, 'STOPPED')
                );
                return { status: 'FAILED', detail };
            }
            await updateClaimedProfile({ lastError: null }, async () => {
                await this.repository.updateLastError(profile.profileName, null);
                return this.repository.getProfile(profile.profileName);
            });
            return { status: 'APPLIED', detail: 'reset completed via rebuild' };
        } catch (error) {
            if (error instanceof OperationLeaseLostError) {
                throw error;
            }
            const detail = error instanceof Error ? error.message : String(error);
            if (!releasePrepared) {
                const completedAt = this.now().toISOString();
                await updateClaimedProfile(
                    {
                        buildStatus: 'FAILED',
                        buildCompletedAt: completedAt,
                        buildError: detail,
                    },
                    () =>
                        this.repository.updateBuildStatus(profile.profileName, 'FAILED', {
                            completedAt,
                            error: detail,
                        })
                );
            }
            return { status: 'FAILED', detail };
        } finally {
            this.buildInFlight = false;
            this.resetInFlight.delete(profile.profileName);
        }
    }

    private async resolveResetSeedInfo(
        profile: GatewayProfileRecord,
        overrides?: { scenarioId?: number | null; tickSeconds?: number },
        databaseUrlOverride?: string
    ): Promise<{
        databaseUrl: string;
        scenarioId: number | null;
        tickSeconds?: number;
        meta: Record<string, unknown>;
    }> {
        const databaseUrl = databaseUrlOverride ?? this.resolveProfileDatabaseUrl(profile);
        let scenarioId = overrides?.scenarioId ?? parseScenarioId(profile.scenario);
        let tickSeconds: number | undefined = overrides?.tickSeconds;
        let meta: Record<string, unknown> = {};
        const connector = createGamePostgresConnector({ url: databaseUrl });
        await connector.connect();
        try {
            const row = await connector.prisma.worldState.findFirst({
                select: { scenarioCode: true, tickSeconds: true, meta: true },
            });
            if (row) {
                if (scenarioId === null) {
                    const resolvedScenario = parseScenarioId(row.scenarioCode);
                    if (resolvedScenario !== null) {
                        scenarioId = resolvedScenario;
                    }
                }
                if (
                    tickSeconds === undefined &&
                    typeof row.tickSeconds === 'number' &&
                    Number.isFinite(row.tickSeconds)
                ) {
                    tickSeconds = row.tickSeconds;
                }
                meta = normalizeMeta(row.meta);
            }
        } finally {
            await connector.disconnect();
        }
        return { databaseUrl, scenarioId, tickSeconds, meta };
    }

    private async runBuildCommands(
        commitSha: string,
        profile?: GatewayProfileRecord
    ): Promise<{
        result: Awaited<ReturnType<BuildRunner['run']>>;
        workspace: Awaited<ReturnType<GitWorkspaceManager['prepare']>>;
    }> {
        const workspace = await this.workspaceManager.prepare(commitSha);
        const commands = [
            ...buildWorkspaceCommands(workspace.root, workspace.needsInstall, this.processConfig.baseEnv),
            ...(profile ? buildProfileFrontendCommands(workspace.root, profile, this.processConfig.baseEnv) : []),
        ];
        return { result: await this.buildRunner.run(commands), workspace };
    }

    private async assertProfileSeedCli(workspaceRoot: string): Promise<void> {
        const sourcePath = path.join(workspaceRoot, 'app', 'gateway-api', 'src', 'orchestrator', 'profileSeedCli.ts');
        try {
            await fs.access(sourcePath);
        } catch {
            throw new Error(`Selected commit does not provide the profile seed CLI: ${sourcePath}`);
        }
    }

    private async runProfileMigration(
        workspaceRoot: string,
        profileDatabaseUrl: string
    ): Promise<Awaited<ReturnType<BuildRunner['run']>>> {
        return this.buildRunner.run([
            buildProfileMigrationCommand(workspaceRoot, profileDatabaseUrl, this.processConfig.baseEnv),
        ]);
    }

    private async runSelectedProfileSeed(options: {
        workspaceRoot: string;
        databaseUrl: string;
        scenarioId: number;
        tickSeconds?: number;
        now: Date;
        installOptions?: ScenarioInstallOptions;
        adminUser?: AdminSeedUser | null;
    }): Promise<Awaited<ReturnType<BuildRunner['run']>>> {
        const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-profile-seed-'));
        const requestFile = path.join(tempDirectory, 'request.json');
        try {
            await fs.writeFile(
                requestFile,
                JSON.stringify({
                    scenarioId: options.scenarioId,
                    tickSeconds: options.tickSeconds,
                    now: options.now.toISOString(),
                    installOptions: options.installOptions
                        ? {
                              ...options.installOptions,
                              preopenAt: options.installOptions.preopenAt?.toISOString() ?? null,
                          }
                        : undefined,
                    adminUser: options.adminUser,
                }),
                { encoding: 'utf8', mode: 0o600 }
            );
            return await this.buildRunner.run([
                {
                    command: process.execPath,
                    args: [path.join(options.workspaceRoot, 'app', 'gateway-api', 'dist', 'index.js')],
                    cwd: options.workspaceRoot,
                    env: {
                        ...(this.processConfig.baseEnv ?? {}),
                        DATABASE_URL: options.databaseUrl,
                        GATEWAY_ROLE: 'profile-seed',
                        PROFILE_SEED_REQUEST_FILE: requestFile,
                    },
                },
            ]);
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    }

    private resolveProfileDatabaseUrl(profile: GatewayProfileRecord): string {
        return resolvePostgresConfigFromEnv({
            env: this.processConfig.baseEnv ?? process.env,
            schema: profile.profile,
        }).url;
    }

    private async clearTournamentRuntimeStateFromRedis(profileName: string): Promise<void> {
        const connector = createRedisConnector(resolveRedisConfigFromEnv(this.processConfig.baseEnv ?? process.env));
        await connector.connect();
        try {
            await clearTournamentRuntimeKeys(connector.client, profileName);
        } finally {
            await connector.disconnect();
        }
    }

    async cleanupStaleWorkspaces(): Promise<{ removed: string[]; skipped: string[] }> {
        const profiles = await this.repository.listProfiles();
        const cutoff = this.computeCutoffDate(6);
        const workspaceMap = new Map<string, { profileNames: string[]; lastUsedAt?: Date; hasActiveBuild: boolean }>();
        for (const profile of profiles) {
            const workspace = profile.buildWorkspace;
            if (!workspace) {
                continue;
            }
            const entry = workspaceMap.get(workspace) ?? {
                profileNames: [],
                lastUsedAt: undefined,
                hasActiveBuild: false,
            };
            entry.profileNames.push(profile.profileName);
            if (profile.buildLastUsedAt) {
                const usedAt = new Date(profile.buildLastUsedAt);
                if (!entry.lastUsedAt || usedAt > entry.lastUsedAt) {
                    entry.lastUsedAt = usedAt;
                }
            }
            if (profile.buildStatus === 'RUNNING' || profile.buildStatus === 'QUEUED') {
                entry.hasActiveBuild = true;
            }
            workspaceMap.set(workspace, entry);
        }

        const activeProcesses = (await this.processManager.list()).filter((process) =>
            isRuntimeProcessActive(process.status)
        );
        const referencedWorkspaces = new Set<string>();
        for (const [workspace, entry] of workspaceMap.entries()) {
            const profileProcessNames = new Set(
                entry.profileNames.flatMap((profileName) => [
                    buildProcessName(profileName, 'frontend'),
                    buildProcessName(profileName, 'api'),
                    buildProcessName(profileName, 'daemon'),
                    buildProcessName(profileName, 'auction'),
                    buildProcessName(profileName, 'battle-sim'),
                    buildProcessName(profileName, 'tournament'),
                ])
            );
            if (
                activeProcesses.some(
                    (process) =>
                        profileProcessNames.has(process.name) ||
                        isPathInside(process.cwd, workspace) ||
                        isPathInside(process.script, workspace)
                )
            ) {
                referencedWorkspaces.add(workspace);
            }
        }

        const removed: string[] = [];
        const skipped: string[] = [];
        for (const [workspace, entry] of workspaceMap.entries()) {
            if (!entry.lastUsedAt || entry.hasActiveBuild || referencedWorkspaces.has(workspace)) {
                skipped.push(workspace);
                continue;
            }
            if (entry.lastUsedAt > cutoff) {
                skipped.push(workspace);
                continue;
            }
            await this.workspaceManager.remove(workspace);
            await this.repository.clearWorkspaceUsage(entry.profileNames);
            removed.push(workspace);
        }

        return { removed, skipped };
    }

    private computeCutoffDate(months: number): Date {
        const date = this.now();
        const cutoff = new Date(date);
        cutoff.setMonth(cutoff.getMonth() - months);
        return cutoff;
    }

    private async startProfile(profile: GatewayProfileRecord, assertLease?: () => Promise<void>): Promise<boolean> {
        const definitions = buildProcessDefinitions(profile, this.processConfig);
        const orderedDefinitions = [
            definitions.frontend,
            definitions.api,
            definitions.daemon,
            definitions.auction,
            definitions.battleSim,
            definitions.tournament,
        ];
        const attemptedNames: string[] = [];
        try {
            const expectedNames = new Set(orderedDefinitions.map((definition) => definition.name));
            const existingNames = new Set(
                (await this.processManager.list())
                    .filter((process) => expectedNames.has(process.name))
                    .map((process) => process.name)
            );
            for (const name of existingNames) {
                await assertLease?.();
                await this.processManager.delete(name);
                await assertLease?.();
            }
            for (const definition of orderedDefinitions) {
                await assertLease?.();
                attemptedNames.push(definition.name);
                await this.processManager.start(definition);
                await assertLease?.();
            }
            if (!assertLease) {
                await this.repository.updateLastError(profile.profileName, null);
            }
            return true;
        } catch (error) {
            if (error instanceof OperationLeaseLostError) {
                throw error;
            }
            await assertLease?.();
            for (const name of attemptedNames.reverse()) {
                await assertLease?.();
                try {
                    await this.processManager.delete(name);
                } catch {
                    // Preserve the original start failure. Reconciliation can retry cleanup.
                }
                await assertLease?.();
            }
            if (!assertLease) {
                await this.repository.updateLastError(
                    profile.profileName,
                    error instanceof Error ? error.message : 'Failed to start processes.'
                );
            }
            return false;
        }
    }

    private async waitForProfileReadiness(
        profile: GatewayProfileRecord,
        assertLease?: () => Promise<void>
    ): Promise<boolean> {
        const deadline = Date.now() + this.profileReadinessTimeoutMs;
        const definitions = buildProcessDefinitions(profile, this.processConfig);
        const expectedNames = Object.values(definitions).map((definition) => definition.name);
        const apiUrl = `http://127.0.0.1:${profile.apiPort}/healthz`;
        const frontendUrl = `http://127.0.0.1:${profile.apiPort - 1}/${profile.profile}/`;
        while (Date.now() < deadline) {
            await assertLease?.();
            try {
                const [api, frontend, processes] = await Promise.all([
                    this.fetchImpl(apiUrl),
                    this.fetchImpl(frontendUrl),
                    this.processManager.list(),
                ]);
                const expectedProcesses = processes.filter((process) => expectedNames.includes(process.name));
                const safeProcesses = expectedProcesses.filter(
                    (process) => process.status.toLowerCase() === 'online' && (process.restartCount ?? 0) === 0
                );
                if (
                    api.ok &&
                    frontend.ok &&
                    expectedProcesses.length === expectedNames.length &&
                    safeProcesses.length === expectedNames.length &&
                    new Set(safeProcesses.map((process) => process.name)).size === expectedNames.length
                ) {
                    return true;
                }
            } catch {
                // Retry until the bounded deadline.
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 500));
        }
        return false;
    }

    private async stopProfile(profile: GatewayProfileRecord, assertLease?: () => Promise<void>): Promise<void> {
        const frontendName = buildProcessName(profile.profileName, 'frontend');
        const apiName = buildProcessName(profile.profileName, 'api');
        const daemonName = buildProcessName(profile.profileName, 'daemon');
        const auctionName = buildProcessName(profile.profileName, 'auction');
        const battleSimName = buildProcessName(profile.profileName, 'battle-sim');
        const tournamentName = buildProcessName(profile.profileName, 'tournament');
        await assertLease?.();
        const existingNames = new Set((await this.processManager.list()).map((process) => process.name));
        await assertLease?.();
        const failures: string[] = [];
        for (const name of [frontendName, apiName, daemonName, auctionName, battleSimName, tournamentName]) {
            if (!existingNames.has(name)) {
                continue;
            }
            await assertLease?.();
            try {
                await this.processManager.stop(name);
            } catch {
                // Deleting the definition below also terminates a process that raced with stop.
            }
            await assertLease?.();
            try {
                await this.processManager.delete(name);
            } catch (error) {
                if (!isMissingProcessError(error)) {
                    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            await assertLease?.();
        }
        if (failures.length > 0) {
            throw new Error(`Failed to stop profile processes: ${failures.join('; ')}`);
        }
    }

    private async loadProcessStatusMap(): Promise<Map<string, boolean>> {
        const processes = await this.processManager.list();
        const statusMap = new Map<string, boolean>();
        for (const process of processes) {
            const status = process.status.toLowerCase();
            const running = status === 'online' || status === 'launching' || status === 'stopping';
            statusMap.set(process.name, running);
        }
        return statusMap;
    }
}
