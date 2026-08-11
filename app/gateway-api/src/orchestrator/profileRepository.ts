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

export const GATEWAY_OPERATION_TYPES = ['RESET', 'DEPLOY', 'START', 'STOP'] as const;
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
    leaseOwner?: string;
    leaseUntil?: string;
    heartbeatAt?: string;
    attempts?: number;
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

export const GATEWAY_OPERATION_LOG_LEVELS = ['INFO', 'OUTPUT', 'ERROR'] as const;
export type GatewayOperationLogLevel = (typeof GATEWAY_OPERATION_LOG_LEVELS)[number];

export interface GatewayOperationLogRecord {
    cursor: string;
    operationId: string;
    level: GatewayOperationLogLevel;
    phase: string;
    message: string;
    createdAt: string;
}

export interface GatewayOperationLogInput {
    level: GatewayOperationLogLevel;
    phase: string;
    message: string;
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

export interface GatewayClaimedProfileUpdate {
    scenario?: string;
    status?: GatewayProfileStatus;
    buildStatus?: GatewayBuildStatus;
    buildCommitSha?: string | null;
    buildWorkspace?: string | null;
    buildLastUsedAt?: string | null;
    preopenAt?: string | null;
    openAt?: string | null;
    scheduledStartAt?: string | null;
    buildRequestedAt?: string | null;
    buildStartedAt?: string | null;
    buildCompletedAt?: string | null;
    buildError?: string | null;
    lastError?: string | null;
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
    listActiveOperationProfileNames?(now: Date): Promise<string[]>;
    getOperation(id: string): Promise<GatewayOperationRecord | null>;
    listOperationLogs(id: string, afterCursor?: string, limit?: number): Promise<GatewayOperationLogRecord[]>;
    appendOperationLog(id: string, input: GatewayOperationLogInput): Promise<GatewayOperationLogRecord>;
    createOperation(input: GatewayOperationCreateInput): Promise<GatewayOperationRecord>;
    claimNextOperation(
        now: Date,
        lease?: { ownerId: string; durationMs: number }
    ): Promise<GatewayOperationRecord | null>;
    renewOperationLease?(id: string, ownerId: string, now: Date, durationMs: number): Promise<boolean>;
    pinOperationResolvedCommit?(id: string, ownerId: string, resolvedCommitSha: string): Promise<boolean>;
    updateProfileForOperation?(
        id: string,
        ownerId: string,
        profileName: string,
        patch: GatewayClaimedProfileUpdate
    ): Promise<GatewayProfileRecord | null>;
    completeOperation(
        id: string,
        status: Extract<GatewayOperationStatus, 'SUCCEEDED' | 'FAILED'>,
        fields: { resolvedCommitSha?: string | null; error?: string | null } | undefined,
        leaseOwner: string
    ): Promise<GatewayOperationRecord>;
    requeueOperation(
        id: string,
        detail: string | undefined,
        retryAt: string | undefined,
        leaseOwner: string
    ): Promise<GatewayOperationRecord>;
    cancelOperation(id: string): Promise<boolean>;
    retryOperation(id: string, requestedBy: string): Promise<GatewayOperationRecord | null>;
}

const toIso = (value: Date | null): string | undefined => (value ? value.toISOString() : undefined);

export const buildRetryOperationPayload = (
    previousPayload: GatewayPrisma.JsonObject,
    previousOperationId: string
): GatewayPrisma.JsonObject => ({
    ...previousPayload,
    installOperationId:
        typeof previousPayload.installOperationId === 'string'
            ? previousPayload.installOperationId
            : previousOperationId,
});

export const buildRetryOperationSource = (previous: {
    sourceMode: GatewaySourceMode | null;
    sourceRef: string | null;
    resolvedCommitSha: string | null;
}): { sourceMode: GatewaySourceMode | null; sourceRef: string | null } =>
    previous.resolvedCommitSha
        ? { sourceMode: 'COMMIT', sourceRef: previous.resolvedCommitSha }
        : { sourceMode: previous.sourceMode, sourceRef: previous.sourceRef };

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
    leaseOwner: string | null;
    leaseUntil: Date | null;
    heartbeatAt: Date | null;
    attempts: number;
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
    leaseOwner: row.leaseOwner ?? undefined,
    leaseUntil: toIso(row.leaseUntil),
    heartbeatAt: toIso(row.heartbeatAt),
    attempts: row.attempts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
});

const mapOperationLog = (row: {
    id: bigint;
    operationId: string;
    level: string;
    phase: string;
    message: string;
    createdAt: Date;
}): GatewayOperationLogRecord => ({
    cursor: row.id.toString(),
    operationId: row.operationId,
    level: GATEWAY_OPERATION_LOG_LEVELS.includes(row.level as GatewayOperationLogLevel)
        ? (row.level as GatewayOperationLogLevel)
        : 'INFO',
    phase: row.phase,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
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
    async listActiveOperationProfileNames(now: Date): Promise<string[]> {
        const rows = await prisma.gatewayOperation.findMany({
            where: {
                OR: [
                    { status: 'RUNNING' },
                    {
                        status: 'QUEUED',
                        OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
                    },
                ],
            },
            select: { profileName: true },
            distinct: ['profileName'],
        });
        return rows.map(({ profileName }) => profileName);
    },
    async getOperation(id: string): Promise<GatewayOperationRecord | null> {
        const row = await prisma.gatewayOperation.findUnique({ where: { id } });
        return row ? mapOperation(row) : null;
    },
    async listOperationLogs(id, afterCursor, limit = 200) {
        const rows = await prisma.gatewayOperationLog.findMany({
            where: {
                operationId: id,
                ...(afterCursor ? { id: { gt: BigInt(afterCursor) } } : {}),
            },
            orderBy: { id: 'asc' },
            take: Math.min(Math.max(limit, 1), 500),
        });
        return rows.map(mapOperationLog);
    },
    async appendOperationLog(id, input) {
        const row = await prisma.gatewayOperationLog.create({
            data: {
                operationId: id,
                level: input.level,
                phase: input.phase.slice(0, 64),
                message: input.message.slice(0, 4_000),
            },
        });
        return mapOperationLog(row);
    },
    async createOperation(input: GatewayOperationCreateInput): Promise<GatewayOperationRecord> {
        const row = await prisma.$transaction(async (tx) => {
            const operation = await tx.gatewayOperation.create({
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
            await tx.gatewayOperationLog.create({
                data: {
                    operationId: operation.id,
                    level: 'INFO',
                    phase: 'queue',
                    message: `${input.type} 작업이 등록되었습니다.`,
                },
            });
            return operation;
        });
        return mapOperation(row);
    },
    async claimNextOperation(
        now: Date,
        lease?: { ownerId: string; durationMs: number }
    ): Promise<GatewayOperationRecord | null> {
        const row = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw<Array<{ lock_result: string }>>`
                SELECT pg_advisory_xact_lock(hashtextextended('gateway_operation_claim', 0))::text AS lock_result
            `;
            const staleBefore = lease ? new Date(now.getTime() - lease.durationMs) : now;
            const running = await tx.gatewayOperation.findFirst({
                where: { status: 'RUNNING' },
                orderBy: { createdAt: 'asc' },
            });
            const runningIsStale = Boolean(
                lease &&
                running &&
                ((running.leaseUntil && running.leaseUntil < now) ||
                    (!running.leaseUntil && running.startedAt && running.startedAt <= staleBefore))
            );
            if (running && !runningIsStale) {
                return null;
            }
            const candidate =
                running ??
                (await tx.gatewayOperation.findFirst({
                    where: {
                        status: 'QUEUED',
                        OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
                    },
                    orderBy: { createdAt: 'asc' },
                }));
            if (!candidate) {
                return null;
            }
            const claimed = await tx.gatewayOperation.updateMany({
                where:
                    candidate.status === 'QUEUED'
                        ? { id: candidate.id, status: 'QUEUED' }
                        : { id: candidate.id, status: 'RUNNING', leaseUntil: candidate.leaseUntil },
                data: {
                    status: 'RUNNING',
                    startedAt: candidate.startedAt ?? now,
                    completedAt: null,
                    error: null,
                    leaseOwner: lease?.ownerId,
                    leaseUntil: lease ? new Date(now.getTime() + lease.durationMs) : undefined,
                    heartbeatAt: lease ? now : undefined,
                    attempts: { increment: 1 },
                },
            });
            if (claimed.count !== 1) {
                return null;
            }
            return tx.gatewayOperation.findUnique({ where: { id: candidate.id } });
        });
        return row ? mapOperation(row) : null;
    },
    async renewOperationLease(id: string, ownerId: string, now: Date, durationMs: number): Promise<boolean> {
        const renewed = await prisma.gatewayOperation.updateMany({
            where: { id, status: 'RUNNING', leaseOwner: ownerId },
            data: {
                leaseUntil: new Date(now.getTime() + durationMs),
                heartbeatAt: now,
            },
        });
        return renewed.count === 1;
    },
    async pinOperationResolvedCommit(id: string, ownerId: string, resolvedCommitSha: string): Promise<boolean> {
        const pinned = await prisma.gatewayOperation.updateMany({
            where: {
                id,
                status: 'RUNNING',
                leaseOwner: ownerId,
                OR: [{ resolvedCommitSha: null }, { resolvedCommitSha }],
            },
            data: { resolvedCommitSha },
        });
        return pinned.count === 1;
    },
    async updateProfileForOperation(
        id: string,
        ownerId: string,
        profileName: string,
        patch: GatewayClaimedProfileUpdate
    ): Promise<GatewayProfileRecord | null> {
        const row = await prisma.$transaction(async (tx) => {
            const owned = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT "id"
                FROM "gateway_operation"
                WHERE "id" = ${id}
                  AND "profile_name" = ${profileName}
                  AND "status" = 'RUNNING'
                  AND "lease_owner" = ${ownerId}
                FOR UPDATE
            `;
            if (owned.length !== 1) {
                return null;
            }
            const toDate = (value: string | null | undefined): Date | null | undefined =>
                value === undefined ? undefined : value === null ? null : new Date(value);
            return tx.gatewayProfile.update({
                where: { profileName },
                data: {
                    scenario: patch.scenario,
                    status: patch.status,
                    buildStatus: patch.buildStatus,
                    buildCommitSha: patch.buildCommitSha,
                    buildWorkspace: patch.buildWorkspace,
                    buildLastUsedAt: toDate(patch.buildLastUsedAt),
                    preopenAt: toDate(patch.preopenAt),
                    openAt: toDate(patch.openAt),
                    scheduledStartAt: toDate(patch.scheduledStartAt),
                    buildRequestedAt: toDate(patch.buildRequestedAt),
                    buildStartedAt: toDate(patch.buildStartedAt),
                    buildCompletedAt: toDate(patch.buildCompletedAt),
                    buildError: patch.buildError,
                    lastError: patch.lastError,
                },
            });
        });
        return row ? mapProfile(row) : null;
    },
    async completeOperation(
        id: string,
        status: Extract<GatewayOperationStatus, 'SUCCEEDED' | 'FAILED'>,
        fields: { resolvedCommitSha?: string | null; error?: string | null } | undefined,
        leaseOwner: string
    ): Promise<GatewayOperationRecord> {
        const updated = await prisma.gatewayOperation.updateMany({
            where: { id, status: 'RUNNING', leaseOwner },
            data: {
                status,
                completedAt: new Date(),
                resolvedCommitSha: fields?.resolvedCommitSha === undefined ? undefined : fields.resolvedCommitSha,
                error: fields?.error === undefined ? undefined : fields.error,
                leaseOwner: null,
                leaseUntil: null,
                heartbeatAt: null,
            },
        });
        if (updated.count !== 1) {
            throw new Error(`Operation lease lost before completion: ${id}`);
        }
        const row = await prisma.gatewayOperation.findUniqueOrThrow({ where: { id } });
        return mapOperation(row);
    },
    async requeueOperation(
        id: string,
        detail: string | undefined,
        retryAt: string | undefined,
        leaseOwner: string
    ): Promise<GatewayOperationRecord> {
        const updated = await prisma.gatewayOperation.updateMany({
            where: { id, status: 'RUNNING', leaseOwner },
            data: {
                status: 'QUEUED',
                startedAt: null,
                error: detail,
                scheduledAt: retryAt ? new Date(retryAt) : undefined,
                leaseOwner: null,
                leaseUntil: null,
                heartbeatAt: null,
            },
        });
        if (updated.count !== 1) {
            throw new Error(`Operation lease lost before requeue: ${id}`);
        }
        const row = await prisma.gatewayOperation.findUniqueOrThrow({ where: { id } });
        return mapOperation(row);
    },
    async cancelOperation(id: string): Promise<boolean> {
        const count = await prisma.$transaction(async (tx) => {
            const result = await tx.gatewayOperation.updateMany({
                where: { id, status: 'QUEUED' },
                data: { status: 'CANCELLED', completedAt: new Date() },
            });
            if (result.count === 1) {
                await tx.gatewayOperationLog.create({
                    data: {
                        operationId: id,
                        level: 'INFO',
                        phase: 'cancel',
                        message: '대기 중인 작업이 취소되었습니다.',
                    },
                });
            }
            return result.count;
        });
        return count === 1;
    },
    async retryOperation(id: string, requestedBy: string): Promise<GatewayOperationRecord | null> {
        const row = await prisma.$transaction(async (tx) => {
            const previous = await tx.gatewayOperation.findUnique({ where: { id } });
            if (!previous || (previous.status !== 'FAILED' && previous.status !== 'CANCELLED')) {
                return null;
            }
            const previousPayload = previous.payload as GatewayPrisma.JsonObject;
            const retrySource = buildRetryOperationSource(previous);
            const operation = await tx.gatewayOperation.create({
                data: {
                    profileName: previous.profileName,
                    type: previous.type,
                    sourceMode: retrySource.sourceMode,
                    sourceRef: retrySource.sourceRef,
                    payload: buildRetryOperationPayload(previousPayload, previous.id),
                    reason: previous.reason,
                    requestedBy,
                    scheduledAt: null,
                },
            });
            await tx.gatewayOperationLog.create({
                data: {
                    operationId: operation.id,
                    level: 'INFO',
                    phase: 'queue',
                    message: `작업 ${previous.id}의 재시도가 등록되었습니다.`,
                },
            });
            return operation;
        });
        return row ? mapOperation(row) : null;
    },
});
