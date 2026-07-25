import type { GatewayPrisma, GatewayPrismaClient } from '@sammo-ts/infra';

export const GATEWAY_PROFILE_STATUSES = [
    'RESERVED',
    'PREOPEN',
    'RUNNING',
    'PAUSED',
    'COMPLETED',
    'STOPPED',
    'DISABLED',
] as const;
export type GatewayProfileStatus = (typeof GATEWAY_PROFILE_STATUSES)[number];

export const GATEWAY_BUILD_STATUSES = ['IDLE', 'QUEUED', 'RUNNING', 'FAILED', 'SUCCEEDED'] as const;
export type GatewayBuildStatus = (typeof GATEWAY_BUILD_STATUSES)[number];

export const GATEWAY_OPERATION_TYPES = ['RESET', 'START', 'STOP'] as const;
export type GatewayOperationType = (typeof GATEWAY_OPERATION_TYPES)[number];

export const GATEWAY_OPERATION_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export type GatewayOperationStatus = (typeof GATEWAY_OPERATION_STATUSES)[number];

export const GATEWAY_SOURCE_MODES = ['BRANCH', 'COMMIT'] as const;
export type GatewaySourceMode = (typeof GATEWAY_SOURCE_MODES)[number];

export interface GatewayOperationRecord {
    id: string;
    profileName: string;
    type: GatewayOperationType;
    status: GatewayOperationStatus;
    sourceMode?: GatewaySourceMode;
    sourceRef?: string;
    resolvedCommitSha?: string;
    payload: GatewayPrisma.JsonObject;
    reason?: string;
    requestedBy: string;
    scheduledAt?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
}

export interface GatewayOperationCreateInput {
    profileName: string;
    type: GatewayOperationType;
    sourceMode?: GatewaySourceMode;
    sourceRef?: string;
    payload?: GatewayPrisma.JsonObject;
    reason?: string;
    requestedBy: string;
    scheduledAt?: string;
}

export interface GatewayProfileRecord {
    profileName: string;
    profile: string;
    scenario: string;
    apiPort: number;
    status: GatewayProfileStatus;
    buildStatus: GatewayBuildStatus;
    buildCommitSha?: string;
    buildWorkspace?: string;
    buildLastUsedAt?: string;
    preopenAt?: string;
    openAt?: string;
    scheduledStartAt?: string;
    buildRequestedAt?: string;
    buildStartedAt?: string;
    buildCompletedAt?: string;
    buildError?: string;
    lastError?: string;
    meta: GatewayPrisma.JsonObject;
    createdAt: string;
    updatedAt: string;
}

export interface GatewayProfileUpsertInput {
    profile: string;
    scenario: string;
    apiPort: number;
    status?: GatewayProfileStatus;
    preopenAt?: string;
    openAt?: string;
    scheduledStartAt?: string;
    buildCommitSha?: string;
    meta?: GatewayPrisma.JsonObject;
}

export interface GatewayProfileRepository {
    listProfiles(): Promise<GatewayProfileRecord[]>;
    getProfile(profileName: string): Promise<GatewayProfileRecord | null>;
    upsertProfile(input: GatewayProfileUpsertInput): Promise<GatewayProfileRecord>;
    updateScenario(profileName: string, scenario: string): Promise<GatewayProfileRecord | null>;
    updateStatus(
        profileName: string,
        status: GatewayProfileStatus,
        schedule?: {
            preopenAt?: string | null;
            openAt?: string | null;
            scheduledStartAt?: string | null;
        }
    ): Promise<GatewayProfileRecord | null>;
    updateBuildStatus(
        profileName: string,
        status: GatewayBuildStatus,
        fields?: {
            requestedAt?: string | null;
            startedAt?: string | null;
            completedAt?: string | null;
            error?: string | null;
            commitSha?: string | null;
            workspace?: string | null;
            lastUsedAt?: string | null;
        }
    ): Promise<GatewayProfileRecord | null>;
    updateMeta(profileName: string, meta: Record<string, unknown>): Promise<GatewayProfileRecord | null>;
    listReservedToStart(now: Date): Promise<GatewayProfileRecord[]>;
    findQueuedBuild(): Promise<GatewayProfileRecord | null>;
    updateLastError(profileName: string, lastError: string | null): Promise<void>;
    updateWorkspaceUsage(profileName: string, workspace: string, lastUsedAt: string): Promise<void>;
    clearWorkspaceUsage(profileNames: string[]): Promise<void>;
    listOperations(options?: { profileName?: string; limit?: number }): Promise<GatewayOperationRecord[]>;
    getOperation(id: string): Promise<GatewayOperationRecord | null>;
    createOperation(input: GatewayOperationCreateInput): Promise<GatewayOperationRecord>;
    claimNextOperation(now: Date): Promise<GatewayOperationRecord | null>;
    completeOperation(
        id: string,
        status: Extract<GatewayOperationStatus, 'SUCCEEDED' | 'FAILED'>,
        fields?: { resolvedCommitSha?: string | null; error?: string | null }
    ): Promise<GatewayOperationRecord>;
    requeueOperation(id: string, detail?: string, retryAt?: string): Promise<GatewayOperationRecord>;
    cancelOperation(id: string): Promise<boolean>;
    retryOperation(id: string, requestedBy: string): Promise<GatewayOperationRecord | null>;
}

const toIso = (value: Date | null): string | undefined => (value ? value.toISOString() : undefined);

type GatewayProfileRow = {
    profileName: string;
    profile: string;
    scenario: string;
    apiPort: number;
    status: GatewayProfileStatus;
    buildStatus: GatewayBuildStatus;
    buildCommitSha: string | null;
    buildWorkspace: string | null;
    buildLastUsedAt: Date | null;
    preopenAt: Date | null;
    openAt: Date | null;
    scheduledStartAt: Date | null;
    buildRequestedAt: Date | null;
    buildStartedAt: Date | null;
    buildCompletedAt: Date | null;
    buildError: string | null;
    lastError: string | null;
    meta: GatewayPrisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
};

type GatewayOperationRow = {
    id: string;
    profileName: string;
    type: GatewayOperationType;
    status: GatewayOperationStatus;
    sourceMode: GatewaySourceMode | null;
    sourceRef: string | null;
    resolvedCommitSha: string | null;
    payload: GatewayPrisma.JsonValue;
    reason: string | null;
    requestedBy: string;
    scheduledAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    error: string | null;
    createdAt: Date;
    updatedAt: Date;
};

const mapProfile = (row: GatewayProfileRow): GatewayProfileRecord => ({
    profileName: row.profileName,
    profile: row.profile,
    scenario: row.scenario,
    apiPort: row.apiPort,
    status: row.status,
    buildStatus: row.buildStatus,
    buildCommitSha: row.buildCommitSha ?? undefined,
    buildWorkspace: row.buildWorkspace ?? undefined,
    buildLastUsedAt: toIso(row.buildLastUsedAt),
    preopenAt: toIso(row.preopenAt),
    openAt: toIso(row.openAt),
    scheduledStartAt: toIso(row.scheduledStartAt),
    buildRequestedAt: toIso(row.buildRequestedAt),
    buildStartedAt: toIso(row.buildStartedAt),
    buildCompletedAt: toIso(row.buildCompletedAt),
    buildError: row.buildError ?? undefined,
    lastError: row.lastError ?? undefined,
    meta: (row.meta ?? {}) as GatewayPrisma.JsonObject,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
});

const buildProfileName = (profile: string, scenario: string): string => `${profile}:${scenario}`;

const mapOperation = (row: GatewayOperationRow): GatewayOperationRecord => ({
    id: row.id,
    profileName: row.profileName,
    type: row.type,
    status: row.status,
    sourceMode: row.sourceMode ?? undefined,
    sourceRef: row.sourceRef ?? undefined,
    resolvedCommitSha: row.resolvedCommitSha ?? undefined,
    payload: (row.payload ?? {}) as GatewayPrisma.JsonObject,
    reason: row.reason ?? undefined,
    requestedBy: row.requestedBy,
    scheduledAt: toIso(row.scheduledAt),
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    error: row.error ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
});

export const createGatewayProfileRepository = (prisma: GatewayPrismaClient): GatewayProfileRepository => ({
    async listProfiles(): Promise<GatewayProfileRecord[]> {
        const rows = await prisma.gatewayProfile.findMany({
            orderBy: [{ profile: 'asc' }, { scenario: 'asc' }],
        });
        return rows.map(mapProfile);
    },
    async getProfile(profileName: string): Promise<GatewayProfileRecord | null> {
        const row = await prisma.gatewayProfile.findUnique({
            where: { profileName },
        });
        return row ? mapProfile(row) : null;
    },
    async upsertProfile(input: GatewayProfileUpsertInput): Promise<GatewayProfileRecord> {
        const profileName = buildProfileName(input.profile, input.scenario);
        const row = await prisma.gatewayProfile.upsert({
            where: { profileName },
            create: {
                profileName,
                profile: input.profile,
                scenario: input.scenario,
                apiPort: input.apiPort,
                status: input.status ?? 'STOPPED',
                preopenAt: input.preopenAt ? new Date(input.preopenAt) : null,
                openAt: input.openAt ? new Date(input.openAt) : null,
                scheduledStartAt: input.scheduledStartAt ? new Date(input.scheduledStartAt) : null,
                buildCommitSha: input.buildCommitSha ?? null,
                meta: (input.meta ?? {}) as GatewayPrisma.JsonObject,
            },
            update: {
                apiPort: input.apiPort,
                status: input.status,
                preopenAt: input.preopenAt ? new Date(input.preopenAt) : input.preopenAt === null ? null : undefined,
                openAt: input.openAt ? new Date(input.openAt) : input.openAt === null ? null : undefined,
                scheduledStartAt: input.scheduledStartAt
                    ? new Date(input.scheduledStartAt)
                    : input.scheduledStartAt === null
                      ? null
                      : undefined,
                buildCommitSha: input.buildCommitSha === undefined ? undefined : input.buildCommitSha,
                meta: input.meta ? (input.meta as GatewayPrisma.JsonObject) : undefined,
            },
        });
        return mapProfile(row);
    },
    async updateScenario(profileName: string, scenario: string): Promise<GatewayProfileRecord | null> {
        const row = await prisma.gatewayProfile.update({
            where: { profileName },
            data: {
                scenario,
            },
        });
        return row ? mapProfile(row) : null;
    },
    async updateStatus(
        profileName: string,
        status: GatewayProfileStatus,
        schedule?: {
            preopenAt?: string | null;
            openAt?: string | null;
            scheduledStartAt?: string | null;
        }
    ): Promise<GatewayProfileRecord | null> {
        const gatewayProfile = prisma.gatewayProfile;
        const row = await gatewayProfile.update({
            where: { profileName },
            data: {
                status,
                preopenAt:
                    schedule?.preopenAt === undefined
                        ? undefined
                        : schedule?.preopenAt
                          ? new Date(schedule.preopenAt)
                          : null,
                openAt:
                    schedule?.openAt === undefined ? undefined : schedule?.openAt ? new Date(schedule.openAt) : null,
                scheduledStartAt:
                    schedule?.scheduledStartAt === undefined
                        ? undefined
                        : schedule?.scheduledStartAt
                          ? new Date(schedule.scheduledStartAt)
                          : null,
            },
        });
        return row ? mapProfile(row) : null;
    },
    async updateBuildStatus(
        profileName: string,
        status: GatewayBuildStatus,
        fields?: {
            requestedAt?: string | null;
            startedAt?: string | null;
            completedAt?: string | null;
            error?: string | null;
            commitSha?: string | null;
            workspace?: string | null;
            lastUsedAt?: string | null;
        }
    ): Promise<GatewayProfileRecord | null> {
        const gatewayProfile = prisma.gatewayProfile;
        const row = await gatewayProfile.update({
            where: { profileName },
            data: {
                buildStatus: status,
                buildCommitSha: fields?.commitSha === undefined ? undefined : fields.commitSha,
                buildWorkspace: fields?.workspace === undefined ? undefined : fields.workspace,
                buildLastUsedAt:
                    fields?.lastUsedAt === undefined
                        ? undefined
                        : fields?.lastUsedAt
                          ? new Date(fields.lastUsedAt)
                          : null,
                buildRequestedAt:
                    fields?.requestedAt === undefined
                        ? undefined
                        : fields?.requestedAt
                          ? new Date(fields.requestedAt)
                          : null,
                buildStartedAt:
                    fields?.startedAt === undefined ? undefined : fields?.startedAt ? new Date(fields.startedAt) : null,
                buildCompletedAt:
                    fields?.completedAt === undefined
                        ? undefined
                        : fields?.completedAt
                          ? new Date(fields.completedAt)
                          : null,
                buildError: fields?.error === undefined ? undefined : fields.error,
            },
        });
        return row ? mapProfile(row) : null;
    },
    async updateMeta(profileName: string, meta: Record<string, unknown>): Promise<GatewayProfileRecord | null> {
        const gatewayProfile = prisma.gatewayProfile;
        const row = await gatewayProfile.update({
            where: { profileName },
            data: {
                meta: meta as GatewayPrisma.JsonObject,
            },
        });
        return row ? mapProfile(row) : null;
    },
    async listReservedToStart(now: Date): Promise<GatewayProfileRecord[]> {
        const gatewayProfile = prisma.gatewayProfile;
        const rows = await gatewayProfile.findMany({
            where: {
                status: 'RESERVED',
                preopenAt: {
                    lte: now,
                },
            },
        });
        return rows.map(mapProfile);
    },
    async findQueuedBuild(): Promise<GatewayProfileRecord | null> {
        const gatewayProfile = prisma.gatewayProfile;
        const row = await gatewayProfile.findFirst({
            where: { buildStatus: 'QUEUED' },
            orderBy: { buildRequestedAt: 'asc' },
        });
        return row ? mapProfile(row) : null;
    },
    async updateLastError(profileName: string, lastError: string | null): Promise<void> {
        const gatewayProfile = prisma.gatewayProfile;
        await gatewayProfile.update({
            where: { profileName },
            data: { lastError },
        });
    },
    async updateWorkspaceUsage(profileName: string, workspace: string, lastUsedAt: string): Promise<void> {
        const gatewayProfile = prisma.gatewayProfile;
        await gatewayProfile.update({
            where: { profileName },
            data: {
                buildWorkspace: workspace,
                buildLastUsedAt: new Date(lastUsedAt),
            },
        });
    },
    async clearWorkspaceUsage(profileNames: string[]): Promise<void> {
        if (!profileNames.length) {
            return;
        }
        const gatewayProfile = prisma.gatewayProfile;
        await gatewayProfile.updateMany({
            where: {
                profileName: { in: profileNames },
            },
            data: {
                buildWorkspace: null,
                buildLastUsedAt: null,
            },
        });
    },
    async listOperations(options?: { profileName?: string; limit?: number }): Promise<GatewayOperationRecord[]> {
        const rows = await prisma.gatewayOperation.findMany({
            where: options?.profileName ? { profileName: options.profileName } : undefined,
            orderBy: { createdAt: 'desc' },
            take: Math.min(Math.max(options?.limit ?? 50, 1), 200),
        });
        return rows.map(mapOperation);
    },
    async getOperation(id: string): Promise<GatewayOperationRecord | null> {
        const row = await prisma.gatewayOperation.findUnique({ where: { id } });
        return row ? mapOperation(row) : null;
    },
    async createOperation(input: GatewayOperationCreateInput): Promise<GatewayOperationRecord> {
        const row = await prisma.gatewayOperation.create({
            data: {
                profileName: input.profileName,
                type: input.type,
                sourceMode: input.sourceMode,
                sourceRef: input.sourceRef,
                payload: (input.payload ?? {}) as GatewayPrisma.JsonObject,
                reason: input.reason,
                requestedBy: input.requestedBy,
                scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
            },
        });
        return mapOperation(row);
    },
    async claimNextOperation(now: Date): Promise<GatewayOperationRecord | null> {
        const row = await prisma.$transaction(async (tx) => {
            const candidate = await tx.gatewayOperation.findFirst({
                where: {
                    status: 'QUEUED',
                    OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
                },
                orderBy: { createdAt: 'asc' },
            });
            if (!candidate) {
                return null;
            }
            const claimed = await tx.gatewayOperation.updateMany({
                where: { id: candidate.id, status: 'QUEUED' },
                data: { status: 'RUNNING', startedAt: now, error: null },
            });
            if (claimed.count !== 1) {
                return null;
            }
            return tx.gatewayOperation.findUnique({ where: { id: candidate.id } });
        });
        return row ? mapOperation(row) : null;
    },
    async completeOperation(
        id: string,
        status: Extract<GatewayOperationStatus, 'SUCCEEDED' | 'FAILED'>,
        fields?: { resolvedCommitSha?: string | null; error?: string | null }
    ): Promise<GatewayOperationRecord> {
        const row = await prisma.gatewayOperation.update({
            where: { id },
            data: {
                status,
                completedAt: new Date(),
                resolvedCommitSha:
                    fields?.resolvedCommitSha === undefined ? undefined : fields.resolvedCommitSha,
                error: fields?.error === undefined ? undefined : fields.error,
            },
        });
        return mapOperation(row);
    },
    async requeueOperation(id: string, detail?: string, retryAt?: string): Promise<GatewayOperationRecord> {
        const row = await prisma.gatewayOperation.update({
            where: { id },
            data: {
                status: 'QUEUED',
                startedAt: null,
                error: detail,
                scheduledAt: retryAt ? new Date(retryAt) : undefined,
            },
        });
        return mapOperation(row);
    },
    async cancelOperation(id: string): Promise<boolean> {
        const result = await prisma.gatewayOperation.updateMany({
            where: { id, status: 'QUEUED' },
            data: { status: 'CANCELLED', completedAt: new Date() },
        });
        return result.count === 1;
    },
    async retryOperation(id: string, requestedBy: string): Promise<GatewayOperationRecord | null> {
        const row = await prisma.$transaction(async (tx) => {
            const previous = await tx.gatewayOperation.findUnique({ where: { id } });
            if (!previous || (previous.status !== 'FAILED' && previous.status !== 'CANCELLED')) {
                return null;
            }
            return tx.gatewayOperation.create({
                data: {
                    profileName: previous.profileName,
                    type: previous.type,
                    sourceMode: previous.sourceMode,
                    sourceRef: previous.sourceRef,
                    payload: previous.payload as GatewayPrisma.JsonObject,
                    reason: previous.reason,
                    requestedBy,
                    scheduledAt: null,
                },
            });
        });
        return row ? mapOperation(row) : null;
    },
});
