import path from 'node:path';

import { seedScenarioToDatabase } from '@sammo-ts/game-engine';
import { createGamePostgresConnector, resolvePostgresConfigFromEnv } from '@sammo-ts/infra';

import type { BuildRunner } from './buildRunner.js';
import type { ProcessManager } from './processManager.js';
import type { GatewayProfileRecord, GatewayProfileRepository, GatewayProfileStatus } from './profileRepository.js';
import type { GitWorkspaceManager } from './workspaceManager.js';

export interface GatewayProcessConfig {
    workspaceRoot: string;
    redisKeyPrefix: string;
    gameTokenSecret: string;
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
    now?: () => Date;
}

export interface ProfileRuntimeState {
    apiRunning: boolean;
    daemonRunning: boolean;
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
            shouldStart: !(runtime.apiRunning && runtime.daemonRunning),
            shouldStop: false,
        };
    }
    return {
        shouldStart: false,
        shouldStop: runtime.apiRunning || runtime.daemonRunning,
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
}

interface GatewayAdminActionResult {
    status: GatewayAdminActionStatus;
    detail?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeMeta = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

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

const buildProcessName = (profileName: string, role: 'api' | 'daemon'): string =>
    `sammo:${profileName}:${role === 'api' ? 'game-api' : 'turn-daemon'}`;

const buildProcessDefinitions = (
    profile: GatewayProfileRecord,
    config: GatewayProcessConfig
): {
    api: { name: string; script: string; cwd: string; env: Record<string, string> };
    daemon: { name: string; script: string; cwd: string; env: Record<string, string> };
} => {
    const baseEnv = { ...(config.baseEnv ?? {}) };
    const apiName = buildProcessName(profile.profileName, 'api');
    const daemonName = buildProcessName(profile.profileName, 'daemon');
    const apiCwd = path.join(config.workspaceRoot, 'app', 'game-api');
    const daemonCwd = path.join(config.workspaceRoot, 'app', 'game-engine');
    const apiScript = path.join(apiCwd, 'dist', 'index.js');
    const daemonScript = path.join(daemonCwd, 'dist', 'index.js');
    const apiEnv = {
        ...baseEnv,
        PROFILE: profile.profile,
        SCENARIO: profile.scenario,
        GAME_API_PORT: String(profile.apiPort),
        GATEWAY_REDIS_PREFIX: config.redisKeyPrefix,
        GAME_TOKEN_SECRET: config.gameTokenSecret,
    };
    const daemonEnv = {
        ...baseEnv,
        TURN_PROFILE: profile.profile,
        PROFILE: profile.profile,
        SCENARIO: profile.scenario,
        TURN_PROFILE_NAME: profile.profileName,
    };
    return {
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
    };
};

const mapRuntimeStates = (profileNames: string[], processNames: Map<string, boolean>): ProfileRuntimeSnapshot[] =>
    profileNames.map((profileName) => {
        const apiName = buildProcessName(profileName, 'api');
        const daemonName = buildProcessName(profileName, 'daemon');
        return {
            profileName,
            apiRunning: processNames.get(apiName) ?? false,
            daemonRunning: processNames.get(daemonName) ?? false,
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
    private readonly now: () => Date;
    private reconcileTimer?: NodeJS.Timeout;
    private scheduleTimer?: NodeJS.Timeout;
    private buildTimer?: NodeJS.Timeout;
    private adminActionTimer?: NodeJS.Timeout;
    private reconcileInFlight = false;
    private scheduleInFlight = false;
    private buildInFlight = false;
    private adminActionInFlight = false;
    private readonly resetInFlight = new Set<string>();

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
        this.now = options.now ?? (() => new Date());
    }

    start(): void {
        void this.reconcileNow();
        void this.runAdminActionsNow();
        this.reconcileTimer = setInterval(() => void this.reconcileNow(), this.reconcileIntervalMs);
        this.scheduleTimer = setInterval(() => void this.runScheduleNow(), this.scheduleIntervalMs);
        this.buildTimer = setInterval(() => void this.runBuildQueueNow(), this.buildIntervalMs);
        this.adminActionTimer = setInterval(() => void this.runAdminActionsNow(), this.adminActionIntervalMs);
    }

    async stop(): Promise<void> {
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
    }

    async listRuntimeStates(profileNames: string[]): Promise<ProfileRuntimeSnapshot[]> {
        const processStates = await this.loadProcessStatusMap();
        return mapRuntimeStates(profileNames, processStates);
    }

    async reconcileNow(): Promise<void> {
        if (this.reconcileInFlight) {
            return;
        }
        this.reconcileInFlight = true;
        try {
            const profiles = await this.repository.listProfiles();
            if (!profiles.length) {
                return;
            }
            const processStates = await this.loadProcessStatusMap();
            for (const profile of profiles) {
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
        if (this.scheduleInFlight) {
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
        if (this.buildInFlight) {
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
            const result = await this.runBuildCommands(queued.profileName, queued.buildCommitSha);
            const completedAt = this.now().toISOString();
            if (result.ok) {
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

    private async runAdminActionsNow(): Promise<void> {
        if (this.adminActionInFlight) {
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
        action: GatewayAdminActionRecord
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

        const commitSha = profile.buildCommitSha;
        if (!commitSha) {
            return { status: 'FAILED', detail: 'buildCommitSha is missing' };
        }
        if (this.buildInFlight) {
            return { status: 'REQUESTED', detail: 'build already in progress' };
        }
        this.buildInFlight = true;
        this.resetInFlight.add(profile.profileName);
        try {
            const seedInfo = await this.resolveResetSeedInfo(profile);
            if (!seedInfo.scenarioId) {
                return { status: 'FAILED', detail: 'scenarioId is missing' };
            }
            const seedTime =
                action.scheduledAt && action.action === 'RESET_SCHEDULED' ? new Date(action.scheduledAt) : this.now();
            const startedAt = this.now().toISOString();
            await this.repository.updateStatus(profile.profileName, 'STOPPED');
            await this.stopProfile(profile);
            await this.repository.updateBuildStatus(profile.profileName, 'RUNNING', {
                requestedAt: startedAt,
                startedAt,
                error: null,
                commitSha,
            });
            const result = await this.runBuildCommands(profile.profileName, commitSha);
            const completedAt = this.now().toISOString();
            if (!result.ok) {
                await this.repository.updateBuildStatus(profile.profileName, 'FAILED', {
                    completedAt,
                    error: result.output.slice(-4000),
                });
                return { status: 'FAILED', detail: 'build failed' };
            }
            await seedScenarioToDatabase({
                databaseUrl: seedInfo.databaseUrl,
                scenarioId: seedInfo.scenarioId,
                tickSeconds: seedInfo.tickSeconds,
                now: seedTime,
            });
            await this.repository.updateBuildStatus(profile.profileName, 'SUCCEEDED', {
                completedAt,
                error: null,
            });
            await this.repository.updateStatus(profile.profileName, 'RUNNING');
            await this.startProfile(profile);
            return { status: 'APPLIED', detail: 'reset completed via rebuild' };
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            await this.repository.updateBuildStatus(profile.profileName, 'FAILED', {
                completedAt: this.now().toISOString(),
                error: detail,
            });
            return { status: 'FAILED', detail };
        } finally {
            this.buildInFlight = false;
            this.resetInFlight.delete(profile.profileName);
        }
    }

    private async resolveResetSeedInfo(
        profile: GatewayProfileRecord
    ): Promise<{ databaseUrl: string; scenarioId: number | null; tickSeconds?: number }> {
        const databaseUrl = resolvePostgresConfigFromEnv({
            env: this.processConfig.baseEnv ?? process.env,
            schema: profile.profile,
        }).url;
        let scenarioId = parseScenarioId(profile.scenario);
        let tickSeconds: number | undefined;
        const connector = createGamePostgresConnector({ url: databaseUrl });
        await connector.connect();
        try {
            const row = await connector.prisma.worldState.findFirst({
                select: { scenarioCode: true, tickSeconds: true },
            });
            if (row) {
                const resolvedScenario = parseScenarioId(row.scenarioCode);
                if (resolvedScenario !== null) {
                    scenarioId = resolvedScenario;
                }
                if (typeof row.tickSeconds === 'number' && Number.isFinite(row.tickSeconds)) {
                    tickSeconds = row.tickSeconds;
                }
            }
        } finally {
            await connector.disconnect();
        }
        return { databaseUrl, scenarioId, tickSeconds };
    }

    private async runBuildCommands(
        profileName: string,
        commitSha: string
    ): Promise<Awaited<ReturnType<BuildRunner['run']>>> {
        const workspace = await this.workspaceManager.prepare(commitSha);
        const lastUsedAt = this.now().toISOString();
        await this.repository.updateWorkspaceUsage(profileName, workspace.root, lastUsedAt);
        const commands: Array<{
            command: string;
            args: string[];
            cwd: string;
            env?: Record<string, string>;
        }> = [];
        if (workspace.needsInstall) {
            commands.push({
                command: 'pnpm',
                args: ['install'],
                cwd: workspace.root,
                env: this.processConfig.baseEnv,
            });
        }
        commands.push(
            {
                command: 'pnpm',
                args: ['--filter', '@sammo-ts/game-api', 'build'],
                cwd: workspace.root,
                env: this.processConfig.baseEnv,
            },
            {
                command: 'pnpm',
                args: ['--filter', '@sammo-ts/game-engine', 'build'],
                cwd: workspace.root,
                env: this.processConfig.baseEnv,
            }
        );
        return this.buildRunner.run(commands);
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

        const removed: string[] = [];
        const skipped: string[] = [];
        for (const [workspace, entry] of workspaceMap.entries()) {
            if (!entry.lastUsedAt || entry.hasActiveBuild) {
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

    private async startProfile(profile: GatewayProfileRecord): Promise<void> {
        const definitions = buildProcessDefinitions(profile, this.processConfig);
        try {
            await this.processManager.start(definitions.api);
            await this.processManager.start(definitions.daemon);
            await this.repository.updateLastError(profile.profileName, null);
        } catch (error) {
            await this.repository.updateLastError(
                profile.profileName,
                error instanceof Error ? error.message : 'Failed to start processes.'
            );
        }
    }

    private async stopProfile(profile: GatewayProfileRecord): Promise<void> {
        const apiName = buildProcessName(profile.profileName, 'api');
        const daemonName = buildProcessName(profile.profileName, 'daemon');
        try {
            await this.processManager.stop(apiName);
        } catch {
            await this.processManager.delete(apiName);
        }
        try {
            await this.processManager.stop(daemonName);
        } catch {
            await this.processManager.delete(daemonName);
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
