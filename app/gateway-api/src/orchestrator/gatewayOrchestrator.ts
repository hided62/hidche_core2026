import path from 'node:path';

import type { BuildRunner } from './buildRunner.js';
import type { ProcessManager } from './processManager.js';
import type {
    GatewayProfileRecord,
    GatewayProfileRepository,
    GatewayProfileStatus,
} from './profileRepository.js';

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
    processConfig: GatewayProcessConfig;
    reconcileIntervalMs: number;
    scheduleIntervalMs: number;
    buildIntervalMs: number;
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
    listRuntimeStates(profileNames: string[]): Promise<ProfileRuntimeSnapshot[]>;
}

export const planProfileReconcile = (
    status: GatewayProfileStatus,
    runtime: ProfileRuntimeState
): { shouldStart: boolean; shouldStop: boolean } => {
    if (status === 'RUNNING') {
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

const buildProcessName = (profileName: string, role: 'api' | 'daemon'): string =>
    `sammo:${profileName}:${role === 'api' ? 'game-api' : 'turn-daemon'}`;

const buildProcessDefinitions = (
    profile: GatewayProfileRecord,
    config: GatewayProcessConfig
): { api: { name: string; script: string; cwd: string; env: Record<string, string> };
    daemon: { name: string; script: string; cwd: string; env: Record<string, string> } } => {
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

const mapRuntimeStates = (
    profileNames: string[],
    processNames: Map<string, boolean>
): ProfileRuntimeSnapshot[] =>
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
    private readonly processConfig: GatewayProcessConfig;
    private readonly reconcileIntervalMs: number;
    private readonly scheduleIntervalMs: number;
    private readonly buildIntervalMs: number;
    private readonly now: () => Date;
    private reconcileTimer?: NodeJS.Timeout;
    private scheduleTimer?: NodeJS.Timeout;
    private buildTimer?: NodeJS.Timeout;
    private reconcileInFlight = false;
    private scheduleInFlight = false;
    private buildInFlight = false;

    constructor(options: GatewayOrchestratorOptions) {
        this.repository = options.repository;
        this.processManager = options.processManager;
        this.buildRunner = options.buildRunner;
        this.processConfig = options.processConfig;
        this.reconcileIntervalMs = options.reconcileIntervalMs;
        this.scheduleIntervalMs = options.scheduleIntervalMs;
        this.buildIntervalMs = options.buildIntervalMs;
        this.now = options.now ?? (() => new Date());
    }

    start(): void {
        void this.reconcileNow();
        this.reconcileTimer = setInterval(
            () => void this.reconcileNow(),
            this.reconcileIntervalMs
        );
        this.scheduleTimer = setInterval(
            () => void this.runScheduleNow(),
            this.scheduleIntervalMs
        );
        this.buildTimer = setInterval(
            () => void this.runBuildQueueNow(),
            this.buildIntervalMs
        );
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
                try {
                    await this.repository.updateStatus(
                        profile.profileName,
                        'RUNNING',
                        null
                    );
                    await this.startProfile(profile);
                } catch (error) {
                    await this.repository.updateLastError(
                        profile.profileName,
                        error instanceof Error ? error.message : 'Failed to start scheduled profile.'
                    );
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
            const startedAt = this.now().toISOString();
            await this.repository.updateBuildStatus(queued.profileName, 'RUNNING', {
                startedAt,
                error: null,
            });
            const result = await this.buildRunner.run([
                {
                    command: 'pnpm',
                    args: ['--filter', '@sammo-ts/game-api', 'build'],
                    cwd: this.processConfig.workspaceRoot,
                    env: this.processConfig.baseEnv,
                },
                {
                    command: 'pnpm',
                    args: ['--filter', '@sammo-ts/game-engine', 'build'],
                    cwd: this.processConfig.workspaceRoot,
                    env: this.processConfig.baseEnv,
                },
            ]);
            const completedAt = this.now().toISOString();
            if (result.ok) {
                await this.repository.updateBuildStatus(queued.profileName, 'SUCCEEDED', {
                    completedAt,
                    error: null,
                });
                if (queued.status !== 'RUNNING' && queued.status !== 'DISABLED') {
                    await this.repository.updateStatus(
                        queued.profileName,
                        'COMPLETED',
                        queued.scheduledStartAt ? queued.scheduledStartAt : null
                    );
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
            const running =
                status === 'online' || status === 'launching' || status === 'stopping';
            statusMap.set(process.name, running);
        }
        return statusMap;
    }
}
