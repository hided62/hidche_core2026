import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';

import type { ScenarioInstallOptions } from '@sammo-ts/game-engine/scenario/scenarioSeeder.js';
import { applyNextClockProjection } from '@sammo-ts/game-engine/turn/clockProjectionOutbox.js';
import {
    reconcileClockSuspension,
    startClockSuspension,
    type ClockOperationAuthority,
} from '@sammo-ts/game-engine/turn/clockReconciliation.js';
import {
    cancelGame as defaultCancelGame,
    GAME_CANCELLATION_GENERAL_MODES,
    GAME_CANCELLATION_HISTORY_MODES,
    type GameCancellationGeneralMode,
    type GameCancellationHistoryMode,
    type GameCancellationResult,
} from '@sammo-ts/game-engine/scenario/gameCancellation.js';
import { gatewayProfileCapabilities } from '@sammo-ts/common';
import {
    createGamePostgresConnector,
    createRedisConnector,
    CLOCK_OPERATION_PERSISTENCE_LOCK,
    GamePrisma,
    acquireGameSchemaAdvisoryXactLock,
    resolvePostgresPoolMax,
    resolveRedisConfigFromEnv,
} from '@sammo-ts/infra';
import { isRecord } from '@sammo-ts/common';

import { resolveGatewayPostgresConfigFromEnv } from '../gatewayPostgresConfig.js';
import { resolveGatewayProfileDisplayName, resolveGatewayProfileKoreanName } from '../profileOrder.js';

import {
    buildTurboReleaseCommand,
    buildTurboReleaseTaskCommand,
    type BuildCommand,
    type BuildProgressEvent,
    type BuildProgressObserver,
    type BuildRunner,
    createReleaseBuildRunner,
    sanitizeReleaseBuildEnv,
} from './buildRunner.js';
import { sanitizeManagedProcessEnv, type ProcessManager } from './processManager.js';
import type {
    GatewayClaimedProfileUpdate,
    GatewayOperationRecord,
    GatewayProfileRecord,
    GatewayProfileRepository,
    GatewayProfileStatus,
} from './profileRepository.js';
import {
    canReuseActiveProfileWorkspace,
    writeProfileReleaseSource,
    type ProfileReleaseSource,
} from './profileReleaseSource.js';
import {
    DEFAULT_MANAGED_WORKSPACE_KEEP_NEWEST,
    DEFAULT_MANAGED_WORKSPACE_RETENTION_MS,
    type GitWorkspaceManager,
} from './workspaceManager.js';
import type { AdminSeedUser } from './seedProfileDatabase.js';
import { assertReleaseComponents, readReleaseManifest } from './releaseManifest.js';
import {
    DEFAULT_FRONTEND_ARTIFACT_KEEP_NEWEST,
    DEFAULT_FRONTEND_ARTIFACT_RETENTION_MS,
    FrontendArtifactManager,
    resolveFrontendServeMode,
    SHARED_GAME_FRONTEND_KEY,
    type FrontendArtifactCleanupResult,
    type FrontendServeMode,
    type StagedFrontendArtifact,
} from './frontendArtifactManager.js';

export interface GatewayProcessConfig {
    workspaceRoot: string;
    redisKeyPrefix: string;
    gameTokenSecret: string;
    gatewayInternalApiUrl: string;
    frontendServeMode?: FrontendServeMode;
    frontendArtifactRoot?: string;
    frontendReadinessOrigin?: string;
    releaseBuilderUrl?: string;
    baseEnv?: Record<string, string>;
}

const PROFILE_BUILD_ENTRYPOINTS = [
    ['app', 'game-api', 'dist', 'index.js'],
    ['app', 'gateway-api', 'dist', 'index.js'],
] as const;

export const hasCompleteProfileBuildArtifacts = async (
    workspaceRoot: string,
    access: (target: string) => Promise<unknown> = fs.access
): Promise<boolean> => {
    for (const segments of PROFILE_BUILD_ENTRYPOINTS) {
        try {
            await access(path.join(workspaceRoot, ...segments));
        } catch {
            return false;
        }
    }
    return true;
};

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
    cancelGame?: typeof defaultCancelGame;
    transitionProfileClock?: (
        profileName: string,
        action: 'SUSPEND' | 'RESUME',
        reason: string
    ) => Promise<{ phase: string; revision: number }>;
    promoteProfileOpening?: (profile: GatewayProfileRecord) => Promise<void>;
}

const WORKSPACE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;

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

export interface ProfileRuntimeSettingsSnapshot {
    profileName: string;
    /** Ref game_env.isunited compatibility value. Any non-zero value means unification has begun. */
    isUnited: number;
    turnTermMinutes: number;
    blockGeneralCreate: 0 | 1 | 2;
    autorunUser: {
        limitMinutes: number;
        options: Array<'develop' | 'warp' | 'recruit' | 'recruit_high' | 'train' | 'battle' | 'chief'>;
    } | null;
}

type RuntimeAutorunOption =
    NonNullable<ProfileRuntimeSettingsSnapshot['autorunUser']> extends {
        options: Array<infer Option>;
    }
        ? Option
        : never;

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
    listRuntimeSettings?(profileNames: string[]): Promise<ProfileRuntimeSettingsSnapshot[]>;
    transitionProfileClock(
        profileName: string,
        action: 'SUSPEND' | 'RESUME',
        reason: string
    ): Promise<{ phase: string; revision: number }>;
}

export interface GatewayManagedCleanupResult {
    workspaces: { removed: string[]; skipped: string[] };
    artifacts: FrontendArtifactCleanupResult;
}

const SENSITIVE_ENV_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|CLIENT_SECRET|DATABASE_URL|REDIS_URL)/iu;

const managedPostgresPoolMax = (env: Record<string, string>, roleVariable: string, fallback: number): string =>
    String(resolvePostgresPoolMax(env[roleVariable] ?? env.POSTGRES_POOL_MAX, fallback));

export const planProfileReconcile = (
    status: GatewayProfileStatus,
    runtime: ProfileRuntimeState
): { shouldStart: boolean; shouldStop: boolean } => {
    if (gatewayProfileCapabilities(status).runtimeExpected) {
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

export const resolveResetLifecycleStatus = (
    now: Date,
    preopenAt: Date | null,
    openAt: Date | null
): Extract<GatewayProfileStatus, 'RESERVED' | 'PREOPEN' | 'RUNNING'> => {
    if (preopenAt && preopenAt.getTime() > now.getTime()) {
        return 'RESERVED';
    }
    if (openAt && openAt.getTime() > now.getTime()) {
        return 'PREOPEN';
    }
    return 'RUNNING';
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
const OPERATION_CANCELLATION_POLL_INTERVAL_MS = 500;

class OperationLeaseLostError extends Error {}

const normalizeMeta = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const readOperationReleaseSource = (operation: GatewayOperationRecord): ProfileReleaseSource => {
    const stored = normalizeMeta(normalizeMeta(operation.payload).releaseSource);
    const mode = stored.mode;
    const ref = typeof stored.ref === 'string' ? stored.ref.trim() : '';
    if ((mode === 'BRANCH' || mode === 'COMMIT') && ref) {
        return { mode, ref };
    }
    return { mode: operation.sourceMode!, ref: operation.sourceRef! };
};

export const buildTournamentRuntimeKeys = (profileName: string): string[] => [
    `sammo:${profileName}:tournament:state`,
    `sammo:${profileName}:tournament:participants`,
    `sammo:${profileName}:tournament:matches`,
    `sammo:${profileName}:tournament:betting`,
    `sammo:${profileName}:tournament:source-revision`,
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

export const resolveProfileArchiveServerName = (
    profile: Pick<GatewayProfileRecord, 'profileName' | 'profile' | 'meta'>
): string => {
    const meta = normalizeMeta(profile.meta);
    return resolveGatewayProfileKoreanName(profile.profile, meta.korName);
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

const clockRevisionAsNumber = (revision: bigint): number => {
    const value = Number(revision);
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`Clock revision is outside the safe API integer range: ${revision.toString()}.`);
    }
    return value;
};

export const resolveProfileFirstGameIdx = (meta: Record<string, unknown>): number => {
    const raw = meta.firstGameIdx;
    const configured = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
    return Number.isInteger(configured) && configured >= 0 ? configured : 1;
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
        openAt: openAt ?? null,
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
    const profileDatabaseUrl = resolveGatewayPostgresConfigFromEnv(baseEnv, profile.profile).url;
    const backendEnv = {
        ...baseEnv,
        DATABASE_URL: profileDatabaseUrl,
    };
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
    const turnDaemonNodeOptions = baseEnv.TURN_DAEMON_NODE_OPTIONS?.trim();
    const apiEnv = {
        ...backendEnv,
        POSTGRES_POOL_MAX: managedPostgresPoolMax(baseEnv, 'GAME_API_POSTGRES_POOL_MAX', 4),
        GAME_API_ROLE: 'server',
        PROFILE: profile.profile,
        SCENARIO: profile.currentScenario ?? 'default',
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
        ...backendEnv,
        ...(turnDaemonNodeOptions ? { NODE_OPTIONS: turnDaemonNodeOptions } : {}),
        POSTGRES_POOL_MAX: managedPostgresPoolMax(baseEnv, 'TURN_DAEMON_POSTGRES_POOL_MAX', 2),
        GAME_ENGINE_ROLE: 'turn-daemon',
        TURN_PROFILE: profile.profile,
        PROFILE: profile.profile,
        SCENARIO: profile.currentScenario ?? 'default',
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
                POSTGRES_POOL_MAX: managedPostgresPoolMax(baseEnv, 'AUCTION_WORKER_POSTGRES_POOL_MAX', 1),
                GAME_API_ROLE: 'auction-worker',
            },
        },
        battleSim: {
            name: battleSimName,
            script: apiScript,
            cwd: apiCwd,
            env: {
                ...apiEnv,
                POSTGRES_POOL_MAX: managedPostgresPoolMax(baseEnv, 'BATTLE_WORKER_POSTGRES_POOL_MAX', 1),
                GAME_API_ROLE: 'battle-sim-worker',
            },
        },
        tournament: {
            name: tournamentName,
            script: apiScript,
            cwd: apiCwd,
            env: {
                ...apiEnv,
                POSTGRES_POOL_MAX: managedPostgresPoolMax(baseEnv, 'TOURNAMENT_WORKER_POSTGRES_POOL_MAX', 1),
                GAME_API_ROLE: 'tournament-worker',
            },
        },
    };
};

const sanitizeArtifactName = (value: string): string => value.replace(/[^0-9A-Za-z._-]+/g, '_');

const buildProfileFrontendOutDir = (workspaceRoot: string, profileName: string): string =>
    path.join(workspaceRoot, '.release-dist', sanitizeArtifactName(profileName), 'game-frontend');

const buildSharedProfileFrontendOutDir = (workspaceRoot: string): string =>
    path.join(workspaceRoot, 'app', 'game-frontend', '.release-build');

export const buildProfileFrontendCommands = (
    workspaceRoot: string,
    profile: Pick<GatewayProfileRecord, 'profileName' | 'profile' | 'apiPort'>,
    buildCommitSha: string,
    env?: Record<string, string>,
    cacheAnchorRoot: string = workspaceRoot
): BuildCommand[] => {
    if (!/^[0-9a-f]{40,64}$/iu.test(buildCommitSha.trim())) {
        throw new Error('Profile frontend build requires a full commit SHA.');
    }
    const profileFrontendBuildNodeOptions = env?.PROFILE_FRONTEND_BUILD_NODE_OPTIONS?.trim();
    const buildEnv = sanitizeReleaseBuildEnv({
        ...(env ?? {}),
        ...(profileFrontendBuildNodeOptions ? { NODE_OPTIONS: profileFrontendBuildNodeOptions } : {}),
        VITE_APP_BASE_PATH: `/${profile.profile}`,
        VITE_GAME_API_URL: `/${profile.profile}/api/trpc`,
        VITE_GAME_SSE_URL: `/${profile.profile}/api/events`,
        VITE_BUILD_COMMIT_SHA: buildCommitSha.trim().toLowerCase(),
    });
    return [
        buildTurboReleaseTaskCommand(
            workspaceRoot,
            cacheAnchorRoot,
            'build:release',
            ['@sammo-ts/game-frontend'],
            buildEnv
        ),
        {
            command: 'node',
            args: ['tools/build-scripts/materialize-profile-frontend.mjs', profile.profileName],
            cwd: workspaceRoot,
            env: buildEnv,
        },
    ];
};

export const buildSharedProfileFrontendCommands = (
    workspaceRoot: string,
    buildCommitSha: string,
    env?: Record<string, string>,
    cacheAnchorRoot: string = workspaceRoot
): BuildCommand[] => {
    if (!/^[0-9a-f]{40,64}$/iu.test(buildCommitSha.trim())) {
        throw new Error('Shared profile frontend build requires a full commit SHA.');
    }
    const sharedEnv = { ...(env ?? {}) };
    for (const key of ['VITE_APP_BASE_PATH', 'VITE_GAME_API_URL', 'VITE_GAME_SSE_URL', 'VITE_GAME_PROFILE']) {
        delete sharedEnv[key];
    }
    const profileFrontendBuildNodeOptions = env?.PROFILE_FRONTEND_BUILD_NODE_OPTIONS?.trim();
    const buildEnv = sanitizeReleaseBuildEnv({
        ...sharedEnv,
        ...(profileFrontendBuildNodeOptions ? { NODE_OPTIONS: profileFrontendBuildNodeOptions } : {}),
        VITE_ASSET_BASE_PATH: './',
        VITE_BUILD_COMMIT_SHA: buildCommitSha.trim().toLowerCase(),
    });
    return [
        buildTurboReleaseTaskCommand(
            workspaceRoot,
            cacheAnchorRoot,
            'build:release',
            ['@sammo-ts/game-frontend'],
            buildEnv
        ),
    ];
};

export const buildWorkspaceCommands = (
    workspaceRoot: string,
    needsInstall: boolean,
    env?: Record<string, string>,
    cacheAnchorRoot: string = workspaceRoot,
    packageNames: string[] = ['@sammo-ts/game-api', '@sammo-ts/gateway-api']
): BuildCommand[] => {
    const buildEnv = sanitizeReleaseBuildEnv(env);
    const commands: BuildCommand[] = [];
    if (needsInstall) {
        commands.push({
            command: 'pnpm',
            args: ['install', '--frozen-lockfile'],
            cwd: workspaceRoot,
            env: buildEnv,
        });
    }
    commands.push(buildTurboReleaseCommand(workspaceRoot, cacheAnchorRoot, packageNames, buildEnv));
    return commands;
};

const PROFILE_MIGRATION_TIME_ZONE = 'Asia/Seoul';
const PROFILE_MIGRATION_TIME_ZONE_OPTION = `-c TimeZone=${PROFILE_MIGRATION_TIME_ZONE}`;
const PROFILE_MIGRATION_TIME_ZONE_MENTION = /(^|[^A-Z0-9_])timezone(?=$|[^A-Z0-9_])/iu;

const profileMigrationTimeZoneError = (source: string): Error =>
    new Error(
        `Profile migration refused: ${source} must not configure a TimeZone other than ${PROFILE_MIGRATION_TIME_ZONE}.`
    );

const tokenizePostgresOptions = (rawOptions: string, source: string): string[] => {
    const tokens: string[] = [];
    let token = '';
    let quote: "'" | '"' | null = null;
    let escaping = false;

    for (const character of rawOptions) {
        if (escaping) {
            token += character;
            escaping = false;
            continue;
        }
        if (character === '\\') {
            escaping = true;
            continue;
        }
        if (quote) {
            if (character === quote) quote = null;
            else token += character;
            continue;
        }
        if (character === "'" || character === '"') {
            quote = character;
            continue;
        }
        if (/\s/u.test(character)) {
            if (token) {
                tokens.push(token);
                token = '';
            }
            continue;
        }
        token += character;
    }

    if (escaping || quote) throw profileMigrationTimeZoneError(source);
    if (token) tokens.push(token);
    return tokens;
};

const readPostgresOptionTimeZones = (rawOptions: string, source: string): string[] => {
    const tokens = tokenizePostgresOptions(rawOptions, source);
    const timeZones: string[] = [];

    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index]!;
        let setting: string | undefined;
        if (token === '-c') {
            setting = tokens[index + 1];
            index += 1;
        } else if (token.startsWith('-c') && token.length > 2) {
            setting = token.slice(2);
        } else if (token.startsWith('--') && token.length > 2) {
            setting = token.slice(2);
        }

        if (!setting) {
            if (PROFILE_MIGRATION_TIME_ZONE_MENTION.test(token)) throw profileMigrationTimeZoneError(source);
            continue;
        }

        const separator = setting.indexOf('=');
        const name = separator >= 0 ? setting.slice(0, separator).trim() : setting.trim();
        if (name.toLowerCase() !== 'timezone') continue;
        const value = separator >= 0 ? setting.slice(separator + 1).trim() : '';
        if (!value) throw profileMigrationTimeZoneError(source);
        timeZones.push(value);
    }

    if (timeZones.length === 0 && PROFILE_MIGRATION_TIME_ZONE_MENTION.test(rawOptions)) {
        throw profileMigrationTimeZoneError(source);
    }
    return timeZones;
};

const assertProfileMigrationTimeZone = (timeZone: string, source: string): void => {
    if (timeZone.trim().toLowerCase() !== PROFILE_MIGRATION_TIME_ZONE.toLowerCase()) {
        throw profileMigrationTimeZoneError(source);
    }
};

const inspectProfileMigrationDatabaseUrl = (
    profileDatabaseUrl: string
): { url: URL; optionKeys: string[]; existingOptions: string[]; configuredTimeZones: string[] } => {
    let url: URL;
    try {
        url = new URL(profileDatabaseUrl);
    } catch {
        throw new Error('Profile migration refused: DATABASE_URL is not a valid URL.');
    }

    const optionKeys = [...new Set([...url.searchParams.keys()].filter((key) => key.toLowerCase() === 'options'))];
    const existingOptions = optionKeys
        .flatMap((key) => url.searchParams.getAll(key))
        .map((value) => value.trim())
        .filter(Boolean);
    const configuredTimeZones = existingOptions.flatMap((options) =>
        readPostgresOptionTimeZones(options, 'DATABASE_URL options')
    );
    for (const timeZone of configuredTimeZones) {
        assertProfileMigrationTimeZone(timeZone, 'DATABASE_URL options');
    }
    for (const [key, value] of url.searchParams) {
        if (key.toLowerCase() === 'timezone') assertProfileMigrationTimeZone(value, 'DATABASE_URL');
    }

    return { url, optionKeys, existingOptions, configuredTimeZones };
};

const buildProfileMigrationDatabaseUrl = (profileDatabaseUrl: string): string => {
    const { url, optionKeys, existingOptions, configuredTimeZones } =
        inspectProfileMigrationDatabaseUrl(profileDatabaseUrl);

    for (const key of optionKeys) url.searchParams.delete(key);
    if (configuredTimeZones.length === 0) existingOptions.push(PROFILE_MIGRATION_TIME_ZONE_OPTION);
    url.searchParams.set('options', existingOptions.join(' '));
    return url.href;
};

const assertProfileMigrationEnvironmentTimeZone = (env?: Record<string, string>): void => {
    const pgOptions = env?.PGOPTIONS?.trim();
    if (pgOptions) {
        for (const timeZone of readPostgresOptionTimeZones(pgOptions, 'PGOPTIONS')) {
            assertProfileMigrationTimeZone(timeZone, 'PGOPTIONS');
        }
    }
    const pgTimeZone = env?.PGTZ?.trim();
    if (pgTimeZone) assertProfileMigrationTimeZone(pgTimeZone, 'PGTZ');
};

const buildProfileMigrationEnv = (profileDatabaseUrl: string, env?: Record<string, string>): Record<string, string> => {
    assertProfileMigrationEnvironmentTimeZone(env);
    return { ...(env ?? {}), DATABASE_URL: buildProfileMigrationDatabaseUrl(profileDatabaseUrl) };
};

const buildProfileMigrationPreflightEnv = (
    profileDatabaseUrl: string,
    env?: Record<string, string>
): Record<string, string> => {
    inspectProfileMigrationDatabaseUrl(profileDatabaseUrl);
    assertProfileMigrationEnvironmentTimeZone(env);
    return { ...(env ?? {}), DATABASE_URL: profileDatabaseUrl };
};

const PROFILE_MIGRATION_TIME_ZONE_PREFLIGHT = `
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
let connected = false;
try {
    await client.connect();
    connected = true;
    const result = await client.query("SELECT current_setting('TimeZone') AS timezone");
    if (result.rows[0]?.timezone !== '${PROFILE_MIGRATION_TIME_ZONE}') {
        throw new Error('Profile migration refused: database session TimeZone does not match the required migration contract.');
    }
} finally {
    if (connected) await client.end();
}
`.trim();

export const buildProfileMigrationPreflightCommand = (
    workspaceRoot: string,
    profileDatabaseUrl: string,
    env?: Record<string, string>
): BuildCommand => ({
    command: 'pnpm',
    args: [
        '--filter',
        '@sammo-ts/infra',
        'exec',
        'node',
        '--input-type=module',
        '--eval',
        PROFILE_MIGRATION_TIME_ZONE_PREFLIGHT,
    ],
    cwd: workspaceRoot,
    env: buildProfileMigrationPreflightEnv(profileDatabaseUrl, env),
});

export const buildProfileMigrationCommand = (
    workspaceRoot: string,
    profileDatabaseUrl: string,
    env?: Record<string, string>
): BuildCommand => ({
    command: 'pnpm',
    args: ['--filter', '@sammo-ts/infra', 'prisma:migrate:deploy:game'],
    cwd: workspaceRoot,
    env: buildProfileMigrationEnv(profileDatabaseUrl, env),
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
    private readonly releaseBuildRunner: BuildRunner;
    private readonly workspaceManager: GitWorkspaceManager;
    private readonly processConfig: GatewayProcessConfig;
    private readonly frontendServeMode: FrontendServeMode;
    private readonly artifactManager: FrontendArtifactManager;
    private readonly reconcileIntervalMs: number;
    private readonly scheduleIntervalMs: number;
    private readonly buildIntervalMs: number;
    private readonly adminActionIntervalMs: number;
    private readonly profileReadinessTimeoutMs: number;
    private readonly now: () => Date;
    private readonly fetchImpl: typeof fetch;
    private readonly clearTournamentRuntimeState: (profileName: string) => Promise<void>;
    private readonly cancelGame: typeof defaultCancelGame;
    private readonly transitionProfileClockOverride?: GatewayOrchestratorOptions['transitionProfileClock'];
    private readonly promoteProfileOpeningOverride?: GatewayOrchestratorOptions['promoteProfileOpening'];
    private reconcileTimer?: NodeJS.Timeout;
    private scheduleTimer?: NodeJS.Timeout;
    private buildTimer?: NodeJS.Timeout;
    private adminActionTimer?: NodeJS.Timeout;
    private workspaceCleanupTimer?: NodeJS.Timeout;
    private reconcileInFlight = false;
    private scheduleInFlight = false;
    private buildInFlight = false;
    private adminActionInFlight = false;
    private operationInFlight = false;
    private workspaceCleanupInFlight = false;
    private activeOperationAbortSignal?: AbortSignal;
    private readonly resetInFlight = new Set<string>();
    private readonly operationLeaseOwner = randomUUID();
    private readonly inFlightTasks = new Set<Promise<unknown>>();
    private stopping = false;
    private stopPromise?: Promise<void>;

    constructor(options: GatewayOrchestratorOptions) {
        this.repository = options.repository;
        this.processManager = options.processManager;
        this.buildRunner = options.buildRunner;
        this.releaseBuildRunner = createReleaseBuildRunner(
            options.processConfig.releaseBuilderUrl,
            options.buildRunner,
            options.fetchImpl ?? fetch
        );
        this.workspaceManager = options.workspaceManager;
        this.processConfig = options.processConfig;
        this.frontendServeMode = resolveFrontendServeMode(options.processConfig.frontendServeMode);
        this.artifactManager = new FrontendArtifactManager(
            options.processConfig.frontendArtifactRoot ?? '/srv/frontend-artifacts'
        );
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
        this.cancelGame = options.cancelGame ?? defaultCancelGame;
        this.transitionProfileClockOverride = options.transitionProfileClock;
        this.promoteProfileOpeningOverride = options.promoteProfileOpening;
    }

    private sanitizeOperationLogMessage(message: string): string {
        let sanitized = stripVTControlCharacters(message);
        const sensitiveValues = new Set([
            this.processConfig.gameTokenSecret,
            ...Object.entries(this.processConfig.baseEnv ?? {})
                .filter(([name]) => SENSITIVE_ENV_NAME.test(name))
                .map(([, value]) => value),
        ]);
        for (const secret of sensitiveValues) {
            if (secret && secret.length >= 4) sanitized = sanitized.replaceAll(secret, '[REDACTED]');
        }
        return sanitized.replace(/(:\/\/[^:\s/@]+:)[^@\s/]+@/gu, '$1[REDACTED]@').slice(0, 4_000);
    }

    private async appendOperationLog(
        operationId: string,
        phase: string,
        message: string,
        level: 'INFO' | 'OUTPUT' | 'ERROR' = 'INFO'
    ): Promise<void> {
        try {
            await this.repository.appendOperationLog(operationId, {
                level,
                phase,
                message: this.sanitizeOperationLogMessage(message),
            });
        } catch {
            // Progress logging must not make an otherwise recoverable profile operation fail.
        }
    }

    private readonly buildProgress =
        (operationId: string, phase: string): BuildProgressObserver =>
        async (event: BuildProgressEvent) => {
            if (event.type === 'OUTPUT') {
                if (event.message) await this.appendOperationLog(operationId, phase, event.message, 'OUTPUT');
                return;
            }
            const command = [event.command.command, ...event.command.args].join(' ');
            if (event.type === 'COMMAND_START') {
                await this.appendOperationLog(operationId, phase, `$ ${command}`);
                return;
            }
            await this.appendOperationLog(
                operationId,
                phase,
                `${command} 종료 (exit ${event.exitCode ?? 'unknown'})`,
                event.exitCode === 0 ? 'INFO' : 'ERROR'
            );
        };

    start(): void {
        this.stopping = false;
        this.trackTask(this.reconcileNow());
        this.trackTask(this.runOperationsNow().then(() => this.cleanupWorkspacesScheduled()));
        this.trackTask(this.runAdminActionsNow());
        this.reconcileTimer = setInterval(() => this.trackTask(this.reconcileNow()), this.reconcileIntervalMs);
        this.scheduleTimer = setInterval(() => this.trackTask(this.runScheduleNow()), this.scheduleIntervalMs);
        this.buildTimer = setInterval(() => this.trackTask(this.runBuildQueueNow()), this.buildIntervalMs);
        this.adminActionTimer = setInterval(() => {
            this.trackTask(this.runOperationsNow());
            this.trackTask(this.runAdminActionsNow());
        }, this.adminActionIntervalMs);
        this.workspaceCleanupTimer = setInterval(
            () => this.trackTask(this.cleanupWorkspacesScheduled()),
            WORKSPACE_CLEANUP_INTERVAL_MS
        );
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
        if (this.workspaceCleanupTimer) {
            clearInterval(this.workspaceCleanupTimer);
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
        const snapshots = mapRuntimeStates(profileNames, processStates);
        if (this.frontendServeMode === 'preview') return snapshots;
        await Promise.all(
            snapshots.map(async (snapshot) => {
                const profile = await this.repository.getProfile(snapshot.profileName);
                snapshot.frontendRunning = profile
                    ? (await this.artifactManager.readCurrentReleaseId(profile.profile)) !== null
                    : false;
            })
        );
        return snapshots;
    }

    async listRuntimeSettings(profileNames: string[]): Promise<ProfileRuntimeSettingsSnapshot[]> {
        const allowedAutorunOptions = new Set<RuntimeAutorunOption>([
            'develop',
            'warp',
            'recruit',
            'recruit_high',
            'train',
            'battle',
            'chief',
        ] as const);
        const snapshots = await Promise.all(
            profileNames.map(async (profileName): Promise<ProfileRuntimeSettingsSnapshot | null> => {
                const profile = await this.repository.getProfile(profileName);
                if (!profile || profile.currentScenario === null) return null;
                const connector = createGamePostgresConnector({ url: this.resolveProfileDatabaseUrl(profile) });
                try {
                    await connector.connect();
                    const row = await connector.prisma.worldState.findFirst({
                        select: { tickSeconds: true, config: true, meta: true },
                    });
                    if (!row) return null;
                    const config = isRecord(row.config) ? row.config : {};
                    const meta = isRecord(row.meta) ? row.meta : {};
                    const rawBlock = Number(config.blockGeneralCreate ?? 0);
                    const blockGeneralCreate = ([0, 1, 2].includes(rawBlock) ? rawBlock : 0) as 0 | 1 | 2;
                    const rawAutorun = isRecord(meta.autorun_user) ? meta.autorun_user : null;
                    const limitMinutes = rawAutorun ? Number(rawAutorun.limit_minutes ?? 0) : 0;
                    const rawOptions = rawAutorun
                        ? Array.isArray(rawAutorun.options)
                            ? rawAutorun.options
                            : isRecord(rawAutorun.options)
                              ? Object.entries(rawAutorun.options)
                                    .filter(([, enabled]) => enabled === true)
                                    .map(([option]) => option)
                              : []
                        : [];
                    const autorunOptions = rawOptions.filter(
                        (
                            option
                        ): option is 'develop' | 'warp' | 'recruit' | 'recruit_high' | 'train' | 'battle' | 'chief' =>
                            typeof option === 'string' && allowedAutorunOptions.has(option as RuntimeAutorunOption)
                    );
                    return {
                        profileName,
                        isUnited: Number(meta.isunited ?? meta.isUnited ?? 0),
                        turnTermMinutes: Math.max(1, Math.round(row.tickSeconds / 60)),
                        blockGeneralCreate,
                        autorunUser:
                            Number.isInteger(limitMinutes) && limitMinutes > 0 && autorunOptions.length > 0
                                ? { limitMinutes, options: autorunOptions }
                                : null,
                    };
                } catch {
                    return null;
                } finally {
                    await connector.disconnect().catch(() => undefined);
                }
            })
        );
        return snapshots.filter((snapshot): snapshot is ProfileRuntimeSettingsSnapshot => snapshot !== null);
    }

    async transitionProfileClock(
        profileName: string,
        action: 'SUSPEND' | 'RESUME',
        reason: string
    ): Promise<{ phase: string; revision: number }> {
        if (this.transitionProfileClockOverride) {
            return this.transitionProfileClockOverride(profileName, action, reason);
        }
        const profile = await this.repository.getProfile(profileName);
        if (!profile || profile.currentScenario === null) {
            throw new Error(`Profile clock is unavailable: ${profileName}`);
        }
        const postgres = createGamePostgresConnector({ url: this.resolveProfileDatabaseUrl(profile) });
        const redis = createRedisConnector(resolveRedisConfigFromEnv(this.processConfig.baseEnv ?? process.env));
        await postgres.connect();
        await redis.connect();
        try {
            const authorityRows = await postgres.prisma.$queryRaw<
                Array<{ ownerId: string; fencingEpoch: bigint; valid: boolean }>
            >(GamePrisma.sql`
                SELECT owner_id AS "ownerId",
                       fencing_epoch AS "fencingEpoch",
                       lease_until > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS valid
                FROM turn_daemon_lease
                WHERE profile = ${profileName}
            `);
            const liveLease = authorityRows.find((row) => row.valid);
            const authority: ClockOperationAuthority = liveLease
                ? {
                      kind: 'DAEMON',
                      profileName,
                      ownerId: liveLease.ownerId,
                      fencingEpoch: liveLease.fencingEpoch,
                  }
                : { kind: 'OFFLINE', profileName, reason };
            const world = await postgres.prisma.worldState.findFirst({
                orderBy: { id: 'asc' },
                select: { clockPhase: true, clockRevision: true, deadlineGeneration: true },
            });
            if (!world) throw new Error(`Profile has no world_state: ${profileName}`);

            if (action === 'SUSPEND') {
                let suspension = await postgres.prisma.clockSuspension.findFirst({
                    where: { sourceRevision: world.clockRevision, status: 'SUSPENDED' },
                    orderBy: { createdAt: 'desc' },
                });
                if (world.clockPhase === 'RUNNING') {
                    const suffix = createHash('sha256')
                        .update(`${profileName}:${world.clockRevision.toString()}`)
                        .digest('hex')
                        .slice(0, 20);
                    const started = await startClockSuspension({
                        db: postgres.prisma,
                        suspensionId: `gateway-maintenance-${suffix}`,
                        source: 'MAINTENANCE',
                        authority,
                    });
                    suspension = await postgres.prisma.clockSuspension.findUniqueOrThrow({
                        where: { id: started.suspensionId },
                    });
                } else if (world.clockPhase !== 'SUSPENDED') {
                    throw new Error(`Cannot suspend profile clock from ${world.clockPhase}.`);
                }
                if (!suspension) throw new Error('Suspended profile is missing its durable clock ledger.');
                const phaseResult = await redis.client.eval(
                    `
                    local active = redis.call('GET', KEYS[1])
                    if active and active ~= ARGV[1] then return 0 end
                    redis.call('SET', KEYS[1], ARGV[1])
                    redis.call('SET', KEYS[2], ARGV[2])
                    redis.call('SET', KEYS[3], 'SUSPENDED')
                    return 1
                    `,
                    {
                        keys: [
                            `sammo:${profileName}:clock:active-revision`,
                            `sammo:${profileName}:clock:deadline-generation`,
                            `sammo:${profileName}:clock:phase`,
                        ],
                        arguments: [world.clockRevision.toString(), world.deadlineGeneration.toString()],
                    }
                );
                if (Number(phaseResult) !== 1) throw new Error('Redis clock source revision differs from the DB.');
                return { phase: 'SUSPENDED', revision: clockRevisionAsNumber(suspension.sourceRevision) };
            }

            if (world.clockPhase === 'RUNNING') {
                return { phase: 'RUNNING', revision: clockRevisionAsNumber(world.clockRevision) };
            }
            const suspension = await postgres.prisma.clockSuspension.findFirst({
                where: { status: { in: ['SUSPENDED', 'RECONCILING'] } },
                orderBy: { createdAt: 'desc' },
            });
            if (!suspension) throw new Error('Profile resume requires a durable suspended clock ledger.');
            if (world.clockPhase === 'SUSPENDED') {
                await reconcileClockSuspension({ db: postgres.prisma, suspensionId: suspension.id, authority });
            } else if (world.clockPhase !== 'RECONCILING') {
                throw new Error(`Cannot resume profile clock from ${world.clockPhase}.`);
            }
            const projected = await applyNextClockProjection({
                db: postgres.prisma,
                redis: redis.client,
                workerId: `gateway:${this.operationLeaseOwner}`,
            });
            if (projected === 'IDLE') throw new Error('Clock reconciliation has no claimable projection outbox.');
            const resumed = await postgres.prisma.worldState.findFirstOrThrow({
                orderBy: { id: 'asc' },
                select: { clockPhase: true, clockRevision: true },
            });
            if (resumed.clockPhase !== 'RUNNING') throw new Error('Clock projection did not reach RUNNING.');
            return { phase: resumed.clockPhase, revision: clockRevisionAsNumber(resumed.clockRevision) };
        } finally {
            await redis.disconnect().catch(() => undefined);
            await postgres.disconnect().catch(() => undefined);
        }
    }

    private async promoteProfileOpening(profile: GatewayProfileRecord): Promise<void> {
        if (this.promoteProfileOpeningOverride) {
            await this.promoteProfileOpeningOverride(profile);
            return;
        }
        const postgres = createGamePostgresConnector({ url: this.resolveProfileDatabaseUrl(profile) });
        const redis = createRedisConnector(resolveRedisConfigFromEnv(this.processConfig.baseEnv ?? process.env));
        await postgres.connect();
        await redis.connect();
        try {
            const clock = await postgres.prisma.$transaction(async (transaction) => {
                await acquireGameSchemaAdvisoryXactLock(transaction, CLOCK_OPERATION_PERSISTENCE_LOCK);
                const rows = await transaction.$queryRaw<Array<{ id: number }>>(GamePrisma.sql`
                    SELECT id FROM world_state ORDER BY id LIMIT 2 FOR UPDATE
                `);
                if (rows.length !== 1) {
                    throw new Error(`Opening promotion requires exactly one world_state row; found ${rows.length}.`);
                }
                const world = await transaction.worldState.findUniqueOrThrow({ where: { id: rows[0]!.id } });
                if (world.clockPhase === 'RUNNING') {
                    return { revision: world.clockRevision, generation: world.deadlineGeneration };
                }
                if (world.clockPhase !== 'PREOPEN' || world.clockTick !== 0n || !world.clockWallAnchor) {
                    throw new Error(
                        `Opening promotion requires PREOPEN at tick 0; found ${world.clockPhase}@${world.clockTick?.toString() ?? 'null'}.`
                    );
                }
                const [wall] = await transaction.$queryRaw<Array<{ wallNow: Date }>>(GamePrisma.sql`
                    SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamp(3) AS "wallNow"
                `);
                if (!wall || wall.wallNow.getTime() < world.clockWallAnchor.getTime()) {
                    throw new Error('Opening promotion was requested before the scheduled wall instant.');
                }
                await transaction.worldState.update({
                    where: { id: world.id },
                    data: { clockPhase: 'RUNNING' },
                });
                return { revision: world.clockRevision, generation: world.deadlineGeneration };
            });
            const result = await redis.client.eval(
                `
                local revision = redis.call('GET', KEYS[1])
                local generation = redis.call('GET', KEYS[2])
                if revision and revision ~= ARGV[1] then return 0 end
                if generation and generation ~= ARGV[2] then return 0 end
                redis.call('SET', KEYS[1], ARGV[1])
                redis.call('SET', KEYS[2], ARGV[2])
                redis.call('SET', KEYS[3], 'RUNNING')
                return 1
                `,
                {
                    keys: [
                        `sammo:${profile.profileName}:clock:active-revision`,
                        `sammo:${profile.profileName}:clock:deadline-generation`,
                        `sammo:${profile.profileName}:clock:phase`,
                    ],
                    arguments: [clock.revision.toString(), clock.generation.toString()],
                }
            );
            if (Number(result) !== 1) {
                throw new Error('Opening promotion found a different Redis clock revision or generation.');
            }
        } finally {
            await redis.disconnect().catch(() => undefined);
            await postgres.disconnect().catch(() => undefined);
        }
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
                if (this.frontendServeMode === 'static') {
                    runtime.frontendRunning =
                        (await this.artifactManager.readCurrentReleaseId(profile.profile)) !== null;
                }
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
                const preopenAt = parseDateTime(profile.preopenAt);
                const openAt = parseDateTime(profile.openAt);
                if (!preopenAt || !openAt) {
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
                if (profile.currentScenario !== null && profile.buildStatus === 'SUCCEEDED' && profile.buildWorkspace) {
                    const nextStatus = resolveResetLifecycleStatus(now, preopenAt, openAt);
                    if (nextStatus === 'RUNNING') {
                        await this.promoteProfileOpening(profile);
                    }
                    await this.repository.updateStatus(profile.profileName, nextStatus, {
                        preopenAt: profile.preopenAt,
                        openAt: profile.openAt,
                    });
                    await this.repository.updateLastError(profile.profileName, null);
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
                    await this.promoteProfileOpening(profile);
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
        if (this.stopping || this.buildInFlight || this.workspaceCleanupInFlight) {
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
                    const opensImmediately = Boolean(queued.openAt && new Date(queued.openAt) <= this.now());
                    if (opensImmediately) {
                        await this.promoteProfileOpening(queued);
                    }
                    await this.repository.updateStatus(queued.profileName, opensImmediately ? 'RUNNING' : 'PREOPEN', {
                        preopenAt: queued.preopenAt ?? null,
                        openAt: queued.openAt ?? null,
                    });
                } else if (queued.status === 'PREOPEN' && queued.openAt) {
                    if (new Date(queued.openAt) <= this.now()) {
                        await this.promoteProfileOpening(queued);
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
        if (this.stopping || this.operationInFlight || this.buildInFlight || this.workspaceCleanupInFlight) {
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
            const abortController = new AbortController();
            this.activeOperationAbortSignal = abortController.signal;
            const heartbeatTimer = this.repository.renewOperationLease
                ? setInterval(() => {
                      void this.repository
                          .renewOperationLease?.(
                              operation.id,
                              this.operationLeaseOwner,
                              this.now(),
                              OPERATION_LEASE_DURATION_MS
                          )
                          .then((renewed) => {
                              if (!renewed) abortController.abort();
                          })
                          .catch((error) => {
                              console.error('[gateway-orchestrator] operation heartbeat failed', error);
                          });
                  }, OPERATION_HEARTBEAT_INTERVAL_MS)
                : undefined;
            const cancellationTimer = setInterval(() => {
                void this.repository
                    .getOperation(operation.id)
                    .then((current) => {
                        if (
                            !current ||
                            current.status !== 'RUNNING' ||
                            current.leaseOwner !== this.operationLeaseOwner
                        ) {
                            abortController.abort();
                        }
                    })
                    .catch(() => undefined);
            }, OPERATION_CANCELLATION_POLL_INTERVAL_MS);
            try {
                await this.handleOperation(operation);
            } finally {
                clearInterval(cancellationTimer);
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                }
                this.activeOperationAbortSignal = undefined;
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
        await this.appendOperationLog(
            operation.id,
            'claim',
            `${operation.type} 작업을 시작합니다. 시도 ${operation.attempts ?? 1}회차.`
        );
        const profile = await this.repository.getProfile(operation.profileName);
        if (!profile) {
            await this.appendOperationLog(operation.id, 'failed', 'Profile not found.', 'ERROR');
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
                if (!gatewayProfileCapabilities(profile.status).operatorResumable) {
                    throw new Error(`Profile status ${profile.status} cannot be started by an operator.`);
                }
                await this.appendOperationLog(operation.id, 'runtime', '프로필 process를 시작합니다.');
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
                await this.appendOperationLog(operation.id, 'runtime', '프로필 process 시작을 완료했습니다.');
                await updateOperationProfile({ lastError: null }, async () => {
                    await this.repository.updateLastError(profile.profileName, null);
                    return this.repository.getProfile(profile.profileName);
                });
                await this.appendOperationLog(operation.id, 'complete', 'START 작업이 완료되었습니다.');
                await this.repository.completeOperation(
                    operation.id,
                    'SUCCEEDED',
                    { error: null },
                    this.operationLeaseOwner
                );
                return;
            }
            if (operation.type === 'STOP') {
                if (!gatewayProfileCapabilities(profile.status).runtimeExpected && profile.status !== 'STOPPED') {
                    throw new Error(`Profile status ${profile.status} cannot be stopped by an operator.`);
                }
                await this.appendOperationLog(operation.id, 'runtime', '프로필 process를 정지합니다.');
                await updateOperationProfile({ status: 'STOPPED' }, () =>
                    this.repository.updateStatus(profile.profileName, 'STOPPED')
                );
                await this.stopProfile(profile, assertLease);
                await this.appendOperationLog(operation.id, 'complete', 'STOP 작업이 완료되었습니다.');
                await this.repository.completeOperation(
                    operation.id,
                    'SUCCEEDED',
                    { error: null },
                    this.operationLeaseOwner
                );
                return;
            }

            if (!operation.sourceMode || !operation.sourceRef) {
                throw new Error('Operation source mode and ref are required.');
            }
            await this.appendOperationLog(
                operation.id,
                'resolve',
                `${operation.sourceMode} ${operation.sourceRef} 커밋을 해석합니다.`
            );
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
            await this.appendOperationLog(operation.id, 'resolve', `대상 커밋을 ${commitSha}로 고정했습니다.`);
            await assertLease();
            if (operation.type === 'CANCEL_GAME') {
                const payload = normalizeMeta(operation.payload);
                const historyMode = payload.historyMode;
                const generalMode = payload.generalMode;
                const retention = payload.earnedPointRetentionPercent;
                if (
                    typeof historyMode !== 'string' ||
                    !GAME_CANCELLATION_HISTORY_MODES.includes(historyMode as GameCancellationHistoryMode) ||
                    typeof generalMode !== 'string' ||
                    !GAME_CANCELLATION_GENERAL_MODES.includes(generalMode as GameCancellationGeneralMode) ||
                    typeof retention !== 'number' ||
                    !Number.isInteger(retention) ||
                    retention < 0 ||
                    retention > 100 ||
                    !operation.reason
                ) {
                    throw new Error('Game cancellation payload is invalid.');
                }
                const result = await this.handleGameCancellation(
                    profile,
                    operation,
                    commitSha,
                    {
                        historyMode: historyMode as GameCancellationHistoryMode,
                        generalMode: generalMode as GameCancellationGeneralMode,
                        earnedPointRetentionPercent: retention,
                    },
                    assertLease
                );
                await this.appendOperationLog(
                    operation.id,
                    'complete',
                    `게임 취소가 완료되었습니다. 참여자 ${result.participantCount}명, 보존 장수 ${result.preservedGeneralCount}명.`
                );
                await this.repository.completeOperation(
                    operation.id,
                    'SUCCEEDED',
                    { resolvedCommitSha: commitSha, error: null },
                    this.operationLeaseOwner
                );
                return;
            }
            if (operation.type === 'DEPLOY') {
                const result = await this.handleProfileDeploy(
                    profile,
                    commitSha,
                    assertLease,
                    operation.id,
                    readOperationReleaseSource(operation)
                );
                if (!result.ok) {
                    throw new Error(result.detail);
                }
                await this.appendOperationLog(operation.id, 'complete', 'DB 보존 버전 업데이트가 완료되었습니다.');
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
            const result = await this.handleResetAction(
                profile,
                resetAction,
                commitSha,
                assertLease,
                operation.id,
                readOperationReleaseSource(operation)
            );
            if (result.status === 'REQUESTED') {
                const retryAt = new Date(this.now().getTime() + this.adminActionIntervalMs).toISOString();
                await this.appendOperationLog(
                    operation.id,
                    'wait',
                    `${result.detail ?? '작업을 다시 시도합니다.'} 다음 시도: ${retryAt}`
                );
                await this.repository.requeueOperation(operation.id, result.detail, retryAt, this.operationLeaseOwner);
                return;
            }
            if (result.status !== 'APPLIED') {
                throw new Error(result.detail ?? 'Reset failed.');
            }
            await this.appendOperationLog(operation.id, 'complete', '시나리오 초기화가 완료되었습니다.');
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
            await this.appendOperationLog(operation.id, 'failed', detail, 'ERROR');
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

    private async handleGameCancellation(
        profile: GatewayProfileRecord,
        operation: GatewayOperationRecord,
        commitSha: string,
        options: {
            historyMode: GameCancellationHistoryMode;
            generalMode: GameCancellationGeneralMode;
            earnedPointRetentionPercent: number;
        },
        assertLease: () => Promise<void>
    ): Promise<GameCancellationResult> {
        if (!['PREOPEN', 'RUNNING', 'PAUSED', 'STOPPED'].includes(profile.status)) {
            throw new Error(`Profile status ${profile.status} cannot be cancelled.`);
        }
        if (this.buildInFlight) throw new Error('build already in progress');
        this.buildInFlight = true;
        let runtimeStopped = profile.status === 'STOPPED';
        let cancellationCommitted = false;
        const updateClaimedProfile = async (patch: GatewayClaimedProfileUpdate): Promise<GatewayProfileRecord> => {
            if (!this.repository.updateProfileForOperation) {
                throw new Error('Game cancellation requires lease-fenced profile updates.');
            }
            const updated = await this.repository.updateProfileForOperation(
                operation.id,
                this.operationLeaseOwner,
                profile.profileName,
                patch
            );
            if (!updated) {
                throw new OperationLeaseLostError(`Operation lease lost while cancelling game: ${operation.id}`);
            }
            return updated;
        };
        try {
            await this.appendOperationLog(
                operation.id,
                'build',
                '현재 profile 커밋의 취소 도구와 migration을 준비합니다.'
            );
            const { result: buildResult, workspace } = await this.runBuildCommands(commitSha, profile, operation.id);
            await assertLease();
            if (!buildResult.ok) throw new Error(buildResult.output.slice(-4000) || 'profile build failed');

            const databaseUrl = this.resolveProfileDatabaseUrl(profile);
            await this.appendOperationLog(operation.id, 'migration', '게임 취소 schema migration을 적용합니다.');
            const migration = await this.runProfileMigration(
                workspace.root,
                databaseUrl,
                this.buildProgress(operation.id, 'migration')
            );
            await assertLease();
            if (!migration.ok) throw new Error(migration.output.slice(-4000) || 'profile database migration failed');

            if (!runtimeStopped) {
                await updateClaimedProfile({ status: 'STOPPED' });
                await this.appendOperationLog(
                    operation.id,
                    'runtime',
                    '쓰기 차단을 위해 profile process를 정지합니다.'
                );
                await this.stopProfile(profile, assertLease);
                runtimeStopped = true;
            }
            await assertLease();
            await this.appendOperationLog(
                operation.id,
                'settlement',
                '기수·장수 기록과 유산 포인트를 원자적으로 정산합니다.'
            );
            const result = await this.cancelGame({
                cancellationId: operation.id,
                databaseUrl,
                cancelledBy: operation.requestedBy,
                reason: operation.reason ?? '',
                ...options,
                cancelledAt: this.now(),
            });
            cancellationCommitted = true;
            await assertLease();
            await updateClaimedProfile({
                status: 'CANCELLED',
                preopenAt: null,
                openAt: null,
                scheduledStartAt: null,
                lastError: null,
            });
            await this.appendOperationLog(
                operation.id,
                'publish',
                `profile을 재개할 수 없는 CANCELLED 상태로 전환했습니다. 취소 ID: ${result.cancellationId}`
            );
            return result;
        } catch (error) {
            if (error instanceof OperationLeaseLostError) throw error;
            if (runtimeStopped && !cancellationCommitted && profile.status !== 'STOPPED') {
                try {
                    await updateClaimedProfile({ status: profile.status, lastError: null });
                    await this.startProfile(profile, assertLease);
                    runtimeStopped = false;
                } catch {
                    // The original cancellation failure remains authoritative.
                }
            }
            throw error;
        } finally {
            this.buildInFlight = false;
        }
    }

    private async handleProfileDeploy(
        profile: GatewayProfileRecord,
        commitSha: string,
        assertLease: () => Promise<void>,
        operationId: string,
        releaseSource: ProfileReleaseSource
    ): Promise<{ ok: true } | { ok: false; detail: string }> {
        if (this.buildInFlight) {
            return { ok: false, detail: 'build already in progress' };
        }
        this.buildInFlight = true;
        const shouldRun = gatewayProfileCapabilities(profile.status).runtimeExpected;
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
            await this.appendOperationLog(operationId, 'workspace', `커밋 ${commitSha}의 worktree를 준비합니다.`);
            const workspace = await this.workspaceManager.prepare(commitSha);
            await this.appendOperationLog(operationId, 'workspace', `worktree 준비 완료: ${workspace.root}`);
            const manifest = await readReleaseManifest(workspace.root);
            assertReleaseComponents(manifest, ['game-api', 'game-engine', 'game-frontend']);
            const commands = [
                ...buildWorkspaceCommands(
                    workspace.root,
                    workspace.needsInstall,
                    this.processConfig.baseEnv,
                    this.processConfig.workspaceRoot,
                    ['@sammo-ts/game-api']
                ),
                ...(this.frontendServeMode === 'static'
                    ? buildSharedProfileFrontendCommands(
                          workspace.root,
                          commitSha,
                          this.processConfig.baseEnv,
                          this.processConfig.workspaceRoot
                      )
                    : buildProfileFrontendCommands(
                          workspace.root,
                          profile,
                          commitSha,
                          this.processConfig.baseEnv,
                          this.processConfig.workspaceRoot
                      )),
            ];
            await this.appendOperationLog(
                operationId,
                'build',
                `${resolveGatewayProfileDisplayName(profile.profile, profile.instanceKey, profile.meta.korName)} 구성 요소를 빌드합니다.`
            );
            const result = await this.releaseBuildRunner.run(commands, this.buildProgress(operationId, 'build'), {
                signal: this.activeOperationAbortSignal,
            });
            if (!result.ok) {
                await assertLease();
                const detail = result.output.slice(-4000) || 'selected workspace build failed';
                await updateClaimedProfile({
                    buildStatus: 'FAILED',
                    buildCompletedAt: this.now().toISOString(),
                    buildError: detail,
                });
                return { ok: false, detail };
            }

            await this.appendOperationLog(operationId, 'switch', '기존 profile process를 정지합니다.');
            await assertLease();
            await this.stopProfile(profile, assertLease, { preserveStaticFrontend: true });
            oldRuntimeStopped = true;
            const profileDatabaseUrl = this.resolveProfileDatabaseUrl(profile);
            await this.appendOperationLog(operationId, 'migration', '선택 버전의 game migration을 적용합니다.');
            const migration = await this.runProfileMigration(
                workspace.root,
                profileDatabaseUrl,
                this.buildProgress(operationId, 'migration')
            );
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
            await this.appendOperationLog(operationId, 'migration', 'game migration이 완료되었습니다.');

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
                await this.appendOperationLog(operationId, 'switch', '새 버전의 profile process를 시작합니다.');
                const started = await this.startProfile(candidate, assertLease);
                await this.appendOperationLog(operationId, 'readiness', 'profile process readiness를 확인합니다.');
                const ready = started && (await this.waitForProfileReadiness(candidate, assertLease));
                if (!ready) {
                    if (started) {
                        await this.stopProfile(candidate, assertLease);
                    }
                    const rollbackStarted =
                        (await this.startProfile(profile, assertLease)) &&
                        (await this.waitForProfileReadiness(profile, assertLease));
                    await this.appendOperationLog(
                        operationId,
                        'rollback',
                        rollbackStarted
                            ? '새 버전 readiness 실패 후 이전 runtime을 복구했습니다.'
                            : '새 버전 readiness 실패 후 이전 runtime 복구도 실패했습니다.',
                        rollbackStarted ? 'INFO' : 'ERROR'
                    );
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
                await this.appendOperationLog(operationId, 'readiness', 'profile readiness 확인을 통과했습니다.');
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
                meta: writeProfileReleaseSource(profile.meta, releaseSource),
            });
            await this.appendOperationLog(
                operationId,
                'publish',
                `${commitSha}를 active profile 버전으로 게시했습니다.`
            );
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
        operationId?: string,
        releaseSource?: ProfileReleaseSource
    ): Promise<GatewayAdminActionResult> {
        const appendLog = async (
            phase: string,
            message: string,
            level: 'INFO' | 'OUTPUT' | 'ERROR' = 'INFO'
        ): Promise<void> => {
            if (operationId) await this.appendOperationLog(operationId, phase, message, level);
        };
        const buildProgress = (phase: string): BuildProgressObserver | undefined =>
            operationId ? this.buildProgress(operationId, phase) : undefined;
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
            const scenarioId = installScenarioId ?? parseScenarioId(profile.currentScenario);
            if (scenarioId === null) {
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
            const { result, workspace } = await this.runBuildCommands(commitSha, profile, operationId);
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
            await appendLog('seed', '선택 버전의 profile seed CLI를 확인합니다.');
            await this.assertProfileSeedCli(workspace.root);
            // A newly provisioned profile schema has no world_state row (or table) yet.
            // Apply the selected release's migrations before reading optional prior-season
            // metadata; existing profiles still expose the same season/tick values afterward.
            await appendLog('migration', '선택 버전의 game migration을 적용합니다.');
            const migrationResult = await this.runProfileMigration(
                workspace.root,
                profileDatabaseUrl,
                buildProgress('migration')
            );
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
            await appendLog('migration', 'game migration이 완료되었습니다.');
            await appendLog('seed', '기존 season과 tick metadata를 확인합니다.');
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
            const firstGameIdx = resolveProfileFirstGameIdx(profileMeta);
            const baseSeason = readMetaNumber(normalizeMeta(seedInfo.meta), 'season');
            const season = nextSeasonIdx ?? baseSeason ?? 1;
            await updateClaimedProfile({ status: 'STOPPED' }, () =>
                this.repository.updateStatus(profile.profileName, 'STOPPED')
            );
            await appendLog('switch', '기존 profile process를 정지합니다.');
            await this.stopProfile(profile, assertLease);
            await assertLease?.();
            const serverId = buildServerId(profile.profileName, seedTime, installOptions?.installOperationId);
            await appendLog('seed', `시나리오 ${scenarioId}, 시즌 ${season} 초기 데이터를 생성합니다.`);
            const seedResult = await this.runSelectedProfileSeed(
                {
                    workspaceRoot: workspace.root,
                    databaseUrl: seedInfo.databaseUrl,
                    scenarioId,
                    tickSeconds: seedInfo.tickSeconds,
                    now: seedTime,
                    installOptions: {
                        ...(installOptions ?? {}),
                        season,
                        firstGameIdx,
                        serverId,
                        // Snapshot the Gateway display name into this season. Hall and
                        // dynasty archives must not fall back to the runtime instance key.
                        serverName: resolveProfileArchiveServerName(profile),
                        installCommitSha: commitSha,
                    },
                    adminUser,
                },
                buildProgress('seed')
            );
            await assertLease?.();
            if (!seedResult.ok) {
                throw new Error(`Selected profile seed failed: ${seedResult.output.slice(-4000)}`);
            }
            await appendLog('seed', '시나리오 초기 데이터 생성을 완료했습니다.');
            await this.clearTournamentRuntimeState(profile.profileName);
            await assertLease?.();
            const completedAt = this.now().toISOString();
            const now = this.now();
            const desiredStatus = resolveResetLifecycleStatus(now, preopenAt, openAt);
            const publishedProfile = await updateClaimedProfile(
                {
                    currentScenario: String(scenarioId),
                    status: desiredStatus,
                    buildStatus: 'SUCCEEDED',
                    buildCommitSha: commitSha,
                    buildWorkspace: workspace.root,
                    buildLastUsedAt: completedAt,
                    buildCompletedAt: completedAt,
                    buildError: null,
                    preopenAt: preopenAt ? preopenAt.toISOString() : openAt ? openAt.toISOString() : null,
                    openAt: openAt ? openAt.toISOString() : null,
                    scheduledStartAt: action.scheduledAt ?? null,
                    ...(releaseSource ? { meta: writeProfileReleaseSource(profile.meta, releaseSource) } : {}),
                },
                async () => {
                    await this.repository.updateWorkspaceUsage(profile.profileName, workspace.root, completedAt);
                    await this.repository.updateBuildStatus(profile.profileName, 'SUCCEEDED', {
                        completedAt,
                        error: null,
                    });
                    if (String(scenarioId) !== profile.currentScenario) {
                        await this.repository.updateCurrentScenario(profile.profileName, String(scenarioId));
                    }
                    return this.repository.updateStatus(profile.profileName, desiredStatus, {
                        preopenAt: preopenAt ? preopenAt.toISOString() : openAt ? openAt.toISOString() : null,
                        openAt: openAt ? openAt.toISOString() : null,
                        scheduledStartAt: action.scheduledAt ?? null,
                    });
                }
            );
            releasePrepared = true;
            if (desiredStatus === 'RESERVED') {
                await appendLog(
                    'schedule',
                    `${preopenAt?.toISOString() ?? '가오픈 시각'}까지 RESERVED 상태로 접속을 차단합니다.`
                );
            } else {
                const builtProfile = publishedProfile ?? {
                    ...profile,
                    currentScenario: String(scenarioId),
                    scenario: String(scenarioId),
                    status: desiredStatus,
                    buildCommitSha: commitSha,
                    buildWorkspace: workspace.root,
                };
                await appendLog('switch', '초기화된 profile process를 시작합니다.');
                const started = await this.startProfile(builtProfile, assertLease);
                await appendLog('readiness', 'profile process readiness를 확인합니다.');
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
                await appendLog('readiness', 'profile readiness 확인을 통과했습니다.');
            }
            await updateClaimedProfile({ lastError: null }, async () => {
                await this.repository.updateLastError(profile.profileName, null);
                return this.repository.getProfile(profile.profileName);
            });
            await appendLog('publish', `${commitSha}와 시나리오 ${scenarioId} 초기화 상태를 게시했습니다.`);
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
        let scenarioId = overrides?.scenarioId ?? parseScenarioId(profile.currentScenario);
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
        profile?: GatewayProfileRecord,
        operationId?: string
    ): Promise<{
        result: Awaited<ReturnType<BuildRunner['run']>>;
        workspace: Awaited<ReturnType<GitWorkspaceManager['prepare']>>;
    }> {
        if (operationId) {
            await this.appendOperationLog(operationId, 'workspace', `커밋 ${commitSha}의 worktree를 준비합니다.`);
        }
        const workspace = await this.workspaceManager.prepare(commitSha);
        if (operationId) {
            await this.appendOperationLog(operationId, 'workspace', `worktree 준비 완료: ${workspace.root}`);
        }
        const activeWorkspaceReusable =
            canReuseActiveProfileWorkspace(profile, commitSha, workspace) &&
            (await hasCompleteProfileBuildArtifacts(workspace.root));
        if (activeWorkspaceReusable) {
            if (operationId) {
                await this.appendOperationLog(
                    operationId,
                    'build',
                    '이미 최신 커밋의 빌드 산출물이 준비되어 있어 빌드를 생략합니다.'
                );
            }
            return {
                result: { ok: true, exitCode: 0, output: '' },
                workspace,
            };
        }
        const commands = [
            ...buildWorkspaceCommands(
                workspace.root,
                workspace.needsInstall,
                this.processConfig.baseEnv,
                this.processConfig.workspaceRoot
            ),
            ...(profile
                ? this.frontendServeMode === 'static'
                    ? buildSharedProfileFrontendCommands(
                          workspace.root,
                          commitSha,
                          this.processConfig.baseEnv,
                          this.processConfig.workspaceRoot
                      )
                    : buildProfileFrontendCommands(
                          workspace.root,
                          profile,
                          commitSha,
                          this.processConfig.baseEnv,
                          this.processConfig.workspaceRoot
                      )
                : []),
        ];
        if (operationId) {
            await this.appendOperationLog(
                operationId,
                'build',
                `${
                    profile
                        ? resolveGatewayProfileDisplayName(profile.profile, profile.instanceKey, profile.meta.korName)
                        : '대상 서버'
                } 구성 요소를 빌드합니다.`
            );
        }
        return {
            result: await this.releaseBuildRunner.run(
                commands,
                operationId ? this.buildProgress(operationId, 'build') : undefined,
                { signal: this.activeOperationAbortSignal }
            ),
            workspace,
        };
    }

    private async assertProfileSeedCli(workspaceRoot: string): Promise<void> {
        const sourcePath = path.join(workspaceRoot, 'app', 'gateway-api', 'src', 'orchestrator', 'profileSeedCli.ts');
        try {
            await fs.access(sourcePath);
        } catch {
            throw new Error(`Selected commit does not provide the profile seed CLI: ${sourcePath}`);
        }
        const artifactPath = path.join(workspaceRoot, 'app', 'gateway-api', 'dist', 'index.js');
        try {
            await fs.access(artifactPath);
        } catch {
            throw new Error(`Selected commit did not build the profile seed CLI artifact: ${artifactPath}`);
        }
    }

    private async runProfileMigration(
        workspaceRoot: string,
        profileDatabaseUrl: string,
        onProgress?: BuildProgressObserver
    ): Promise<Awaited<ReturnType<BuildRunner['run']>>> {
        return this.buildRunner.run(
            [
                buildProfileMigrationPreflightCommand(workspaceRoot, profileDatabaseUrl, this.processConfig.baseEnv),
                buildProfileMigrationCommand(workspaceRoot, profileDatabaseUrl, this.processConfig.baseEnv),
            ],
            onProgress,
            { signal: this.activeOperationAbortSignal }
        );
    }

    private async runSelectedProfileSeed(
        options: {
            workspaceRoot: string;
            databaseUrl: string;
            scenarioId: number;
            tickSeconds?: number;
            now: Date;
            installOptions?: ScenarioInstallOptions;
            adminUser?: AdminSeedUser | null;
        },
        onProgress?: BuildProgressObserver
    ): Promise<Awaited<ReturnType<BuildRunner['run']>>> {
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
                              openAt: options.installOptions.openAt?.toISOString() ?? null,
                          }
                        : undefined,
                    adminUser: options.adminUser,
                }),
                { encoding: 'utf8', mode: 0o600 }
            );
            return await this.buildRunner.run(
                [
                    {
                        command: process.execPath,
                        args: [path.join(options.workspaceRoot, 'app', 'gateway-api', 'dist', 'index.js')],
                        cwd: options.workspaceRoot,
                        env: {
                            ...(this.processConfig.baseEnv ?? {}),
                            DATABASE_URL: options.databaseUrl,
                            POSTGRES_POOL_MAX: managedPostgresPoolMax(
                                this.processConfig.baseEnv ?? {},
                                'PROFILE_SEED_POSTGRES_POOL_MAX',
                                1
                            ),
                            GATEWAY_ROLE: 'profile-seed',
                            PROFILE_SEED_REQUEST_FILE: requestFile,
                        },
                    },
                ],
                onProgress,
                { signal: this.activeOperationAbortSignal }
            );
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    }

    private resolveProfileDatabaseUrl(profile: GatewayProfileRecord): string {
        return resolveGatewayPostgresConfigFromEnv(this.processConfig.baseEnv ?? process.env, profile.profile).url;
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

    async cleanupStaleResources(): Promise<GatewayManagedCleanupResult> {
        if (this.buildInFlight || this.operationInFlight || this.workspaceCleanupInFlight) {
            const managedWorkspaces = await this.workspaceManager.listManagedWorkspaces();
            return {
                workspaces: { removed: [], skipped: managedWorkspaces.map((workspace) => workspace.root) },
                artifacts: { removed: [], retained: [], skipped: [] },
            };
        }
        this.workspaceCleanupInFlight = true;
        try {
            const managedWorkspaces = await this.workspaceManager.listManagedWorkspaces();
            const [profiles, operations] = await Promise.all([
                this.repository.listProfiles(),
                this.repository.listOperations({ limit: 100 }),
            ]);
            const protectedWorkspaces = new Set<string>();
            for (const profile of profiles) {
                if (profile.buildWorkspace) {
                    protectedWorkspaces.add(path.resolve(profile.buildWorkspace));
                }
                if (profile.buildCommitSha && (profile.buildStatus === 'RUNNING' || profile.buildStatus === 'QUEUED')) {
                    protectedWorkspaces.add(
                        path.resolve(this.workspaceManager.workspacePathForCommit(profile.buildCommitSha))
                    );
                }
            }

            const activeProcesses = (await this.processManager.list()).filter((process) =>
                isRuntimeProcessActive(process.status)
            );
            for (const workspace of managedWorkspaces) {
                if (
                    activeProcesses.some(
                        (process) =>
                            isPathInside(process.cwd, workspace.root) || isPathInside(process.script, workspace.root)
                    )
                ) {
                    protectedWorkspaces.add(workspace.root);
                }
            }

            const workspaces = await this.workspaceManager.cleanup({
                protectedPaths: [...protectedWorkspaces],
                retentionMs: DEFAULT_MANAGED_WORKSPACE_RETENTION_MS,
                keepNewest: DEFAULT_MANAGED_WORKSPACE_KEEP_NEWEST,
            });
            const artifacts: FrontendArtifactCleanupResult =
                this.frontendServeMode === 'static'
                    ? await this.artifactManager.cleanup({
                          frontendKeys: [
                              ...new Set(profiles.map((profile) => profile.profile)),
                              SHARED_GAME_FRONTEND_KEY,
                          ],
                          protectedCommitShas: [
                              ...profiles
                                  .filter(
                                      (profile) =>
                                          profile.buildCommitSha &&
                                          (profile.buildStatus === 'QUEUED' || profile.buildStatus === 'RUNNING')
                                  )
                                  .map((profile) => profile.buildCommitSha as string),
                              ...operations
                                  .filter(
                                      (operation) =>
                                          operation.resolvedCommitSha &&
                                          (operation.status === 'QUEUED' || operation.status === 'RUNNING')
                                  )
                                  .map((operation) => operation.resolvedCommitSha as string),
                          ],
                          retentionMs: DEFAULT_FRONTEND_ARTIFACT_RETENTION_MS,
                          keepNewest: DEFAULT_FRONTEND_ARTIFACT_KEEP_NEWEST,
                          now: this.now(),
                          cleanupProfileWrapperStaging: true,
                      })
                    : { removed: [], retained: [], skipped: [] };
            return { workspaces, artifacts };
        } finally {
            this.workspaceCleanupInFlight = false;
        }
    }

    async cleanupStaleWorkspaces(): Promise<{ removed: string[]; skipped: string[] }> {
        return (await this.cleanupStaleResources()).workspaces;
    }

    private async cleanupWorkspacesScheduled(): Promise<void> {
        if (this.stopping || this.buildInFlight || this.operationInFlight || this.workspaceCleanupInFlight) return;
        const result = await this.cleanupStaleResources();
        console.info(
            `[gateway-orchestrator] managed cleanup completed: removed ${result.workspaces.removed.length} profile worktrees and ${result.artifacts.removed.length} frontend artifacts; retained ${result.artifacts.retained.length}, skipped ${result.artifacts.skipped.length}`
        );
    }

    private async stageStaticProfileFrontend(profile: GatewayProfileRecord): Promise<StagedFrontendArtifact> {
        if (!profile.buildCommitSha) {
            throw new Error(
                `${resolveGatewayProfileDisplayName(
                    profile.profile,
                    profile.instanceKey,
                    profile.meta.korName
                )} 서버의 build commit SHA가 없습니다.`
            );
        }
        const runtimeWorkspace = profile.buildWorkspace ?? this.processConfig.workspaceRoot;
        const sharedSourceRoot = buildSharedProfileFrontendOutDir(runtimeWorkspace);
        const sharedIndexPath = path.join(sharedSourceRoot, 'index.html');
        const sharedIndexHtml = await fs.readFile(sharedIndexPath, 'utf8').catch((error: unknown) => {
            if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            throw error;
        });
        if (sharedIndexHtml?.includes('./assets/')) {
            const sharedArtifact = await this.artifactManager.stage({
                frontendKey: SHARED_GAME_FRONTEND_KEY,
                sourceRoot: sharedSourceRoot,
                commitSha: profile.buildCommitSha,
            });
            const baseEnv = this.processConfig.baseEnv ?? {};
            return this.artifactManager.stageProfileWrapper({
                frontendKey: profile.profile,
                sharedArtifact,
                sharedAssetPublicBase: baseEnv.FRONTEND_SHARED_ASSET_PUBLIC_PATH?.trim() || '/gateway/profile-assets',
                runtimeConfig: {
                    version: 1,
                    profile: profile.profile,
                    profileName: profile.profileName,
                    appBasePath: `/${profile.profile}/`,
                    gameApiUrl: `/${profile.profile}/api/trpc`,
                    gameSseUrl: `/${profile.profile}/api/events`,
                    gatewayApiUrl: baseEnv.VITE_GATEWAY_API_URL?.trim() || '/gateway/api/trpc',
                    gatewayWebUrl: baseEnv.VITE_GATEWAY_WEB_URL?.trim() || '/gateway/',
                },
            });
        }
        return this.artifactManager.stage({
            frontendKey: profile.profile,
            sourceRoot: buildProfileFrontendOutDir(runtimeWorkspace, profile.profileName),
            commitSha: profile.buildCommitSha,
        });
    }

    private async startProfile(profile: GatewayProfileRecord, assertLease?: () => Promise<void>): Promise<boolean> {
        const definitions = buildProcessDefinitions(profile, this.processConfig);
        const orderedDefinitions = [
            ...(this.frontendServeMode === 'preview' ? [definitions.frontend] : []),
            definitions.api,
            definitions.daemon,
            definitions.auction,
            definitions.battleSim,
            definitions.tournament,
        ];
        const attemptedNames: string[] = [];
        try {
            const stagedArtifact =
                this.frontendServeMode === 'static' ? await this.stageStaticProfileFrontend(profile) : null;
            const expectedNames = new Set(orderedDefinitions.map((definition) => definition.name));
            const obsoleteNames =
                this.frontendServeMode === 'static' ? new Set([definitions.frontend.name]) : new Set<string>();
            const existingNames = new Set(
                (await this.processManager.list())
                    .filter((process) => expectedNames.has(process.name) || obsoleteNames.has(process.name))
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
            if (stagedArtifact) {
                await this.artifactManager.activate(profile.profile, stagedArtifact.releaseId);
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
        const deadline = performance.now() + this.profileReadinessTimeoutMs;
        const definitions = buildProcessDefinitions(profile, this.processConfig);
        const expectedNames = Object.entries(definitions)
            .filter(([role]) => this.frontendServeMode === 'preview' || role !== 'frontend')
            .map(([, definition]) => definition.name);
        const apiUrl = `http://127.0.0.1:${profile.apiPort}/healthz`;
        const frontendUrl =
            this.frontendServeMode === 'static'
                ? new URL(
                      `/${profile.profile}/`,
                      this.processConfig.frontendReadinessOrigin ?? 'http://caddy'
                  ).toString()
                : `http://127.0.0.1:${profile.apiPort - 1}/${profile.profile}/`;
        while (performance.now() < deadline) {
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

    private async stopProfile(
        profile: GatewayProfileRecord,
        assertLease?: () => Promise<void>,
        options: { preserveStaticFrontend?: boolean } = {}
    ): Promise<void> {
        const frontendName = buildProcessName(profile.profileName, 'frontend');
        const apiName = buildProcessName(profile.profileName, 'api');
        const daemonName = buildProcessName(profile.profileName, 'daemon');
        const auctionName = buildProcessName(profile.profileName, 'auction');
        const battleSimName = buildProcessName(profile.profileName, 'battle-sim');
        const tournamentName = buildProcessName(profile.profileName, 'tournament');
        await assertLease?.();
        // A normal DEPLOY keeps the last immutable page available while its API is replaced.
        // STOP/RESET still remove the pointer because those operations intentionally close the profile.
        if (this.frontendServeMode === 'static' && !options.preserveStaticFrontend) {
            await this.artifactManager.deactivate(profile.profile);
        }
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
