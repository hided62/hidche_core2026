import type { GatewayPrisma, GatewayPrismaClient } from '@sammo-ts/infra';

import type { GatewayOperationStatus, GatewaySourceMode } from './profileRepository.js';

export const GATEWAY_RELEASE_OPERATION_TYPES = ['DEPLOY', 'ROLLBACK'] as const;
export type GatewayReleaseOperationType = (typeof GATEWAY_RELEASE_OPERATION_TYPES)[number];

export interface GatewayReleaseStateRecord {
    id: string;
    activeCommitSha?: string;
    activeWorkspace?: string;
    previousCommitSha?: string;
    previousWorkspace?: string;
    lastSuccessfulAt?: string;
    lastError?: string;
    updatedAt: string;
}

export interface GatewayReleaseOperationRecord {
    id: string;
    type: GatewayReleaseOperationType;
    status: GatewayOperationStatus;
    sourceMode?: GatewaySourceMode;
    sourceRef?: string;
    resolvedCommitSha?: string;
    payload: GatewayPrisma.JsonObject;
    reason?: string;
    requestedBy: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    leaseOwner?: string;
    leaseUntil?: string;
    heartbeatAt?: string;
    attempts: number;
    createdAt: string;
    updatedAt: string;
}

export interface GatewayReleaseOperationCreateInput {
    type: GatewayReleaseOperationType;
    sourceMode?: GatewaySourceMode;
    sourceRef?: string;
    payload?: GatewayPrisma.JsonObject;
    reason?: string;
    requestedBy: string;
}

export interface GatewayReleaseRepository {
    getState(): Promise<GatewayReleaseStateRecord>;
    listOperations(limit?: number): Promise<GatewayReleaseOperationRecord[]>;
    getOperation(id: string): Promise<GatewayReleaseOperationRecord | null>;
    createOperation(input: GatewayReleaseOperationCreateInput): Promise<GatewayReleaseOperationRecord>;
    claimNextOperation(
        now: Date,
        lease: { ownerId: string; durationMs: number }
    ): Promise<GatewayReleaseOperationRecord | null>;
    renewOperationLease(id: string, ownerId: string, now: Date, durationMs: number): Promise<boolean>;
    pinOperationResolvedCommit(id: string, ownerId: string, resolvedCommitSha: string): Promise<boolean>;
    completeOperation(
        id: string,
        status: Extract<GatewayOperationStatus, 'SUCCEEDED' | 'FAILED'>,
        fields: { resolvedCommitSha?: string | null; error?: string | null },
        leaseOwner: string
    ): Promise<GatewayReleaseOperationRecord>;
    publishRelease(
        operationId: string,
        leaseOwner: string,
        release: { commitSha: string; workspace: string; previousCommitSha?: string; previousWorkspace?: string }
    ): Promise<GatewayReleaseStateRecord>;
    recordStateError(detail: string): Promise<void>;
    cancelOperation(id: string): Promise<boolean>;
    retryOperation(id: string, requestedBy: string): Promise<GatewayReleaseOperationRecord | null>;
}

const toIso = (value: Date | null): string | undefined => (value ? value.toISOString() : undefined);

const mapState = (row: {
    id: string;
    activeCommitSha: string | null;
    activeWorkspace: string | null;
    previousCommitSha: string | null;
    previousWorkspace: string | null;
    lastSuccessfulAt: Date | null;
    lastError: string | null;
    updatedAt: Date;
}): GatewayReleaseStateRecord => ({
    id: row.id,
    activeCommitSha: row.activeCommitSha ?? undefined,
    activeWorkspace: row.activeWorkspace ?? undefined,
    previousCommitSha: row.previousCommitSha ?? undefined,
    previousWorkspace: row.previousWorkspace ?? undefined,
    lastSuccessfulAt: toIso(row.lastSuccessfulAt),
    lastError: row.lastError ?? undefined,
    updatedAt: row.updatedAt.toISOString(),
});

const mapOperation = (row: {
    id: string;
    type: GatewayReleaseOperationType;
    status: GatewayOperationStatus;
    sourceMode: GatewaySourceMode | null;
    sourceRef: string | null;
    resolvedCommitSha: string | null;
    payload: GatewayPrisma.JsonValue;
    reason: string | null;
    requestedBy: string;
    startedAt: Date | null;
    completedAt: Date | null;
    error: string | null;
    leaseOwner: string | null;
    leaseUntil: Date | null;
    heartbeatAt: Date | null;
    attempts: number;
    createdAt: Date;
    updatedAt: Date;
}): GatewayReleaseOperationRecord => ({
    id: row.id,
    type: row.type,
    status: row.status,
    sourceMode: row.sourceMode ?? undefined,
    sourceRef: row.sourceRef ?? undefined,
    resolvedCommitSha: row.resolvedCommitSha ?? undefined,
    payload: (row.payload ?? {}) as GatewayPrisma.JsonObject,
    reason: row.reason ?? undefined,
    requestedBy: row.requestedBy,
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

export const createGatewayReleaseRepository = (prisma: GatewayPrismaClient): GatewayReleaseRepository => ({
    async getState() {
        const row = await prisma.gatewayReleaseState.upsert({
            where: { id: 'gateway' },
            create: { id: 'gateway' },
            update: {},
        });
        return mapState(row);
    },
    async listOperations(limit = 50) {
        const rows = await prisma.gatewayReleaseOperation.findMany({
            orderBy: { createdAt: 'desc' },
            take: Math.min(Math.max(limit, 1), 200),
        });
        return rows.map(mapOperation);
    },
    async getOperation(id) {
        const row = await prisma.gatewayReleaseOperation.findUnique({ where: { id } });
        return row ? mapOperation(row) : null;
    },
    async createOperation(input) {
        const row = await prisma.gatewayReleaseOperation.create({
            data: {
                type: input.type,
                sourceMode: input.sourceMode,
                sourceRef: input.sourceRef,
                payload: input.payload ?? {},
                reason: input.reason,
                requestedBy: input.requestedBy,
            },
        });
        return mapOperation(row);
    },
    async claimNextOperation(now, lease) {
        const row = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw<Array<{ lock_result: string }>>`
                SELECT pg_advisory_xact_lock(hashtextextended('gateway_release_operation_claim', 0))::text AS lock_result
            `;
            const staleBefore = new Date(now.getTime() - lease.durationMs);
            const running = await tx.gatewayReleaseOperation.findFirst({
                where: { status: 'RUNNING' },
                orderBy: { createdAt: 'asc' },
            });
            const runningIsStale = Boolean(
                running &&
                ((running.leaseUntil && running.leaseUntil < now) ||
                    (!running.leaseUntil && running.startedAt && running.startedAt <= staleBefore))
            );
            if (running && !runningIsStale) {
                return null;
            }
            const candidate =
                running ??
                (await tx.gatewayReleaseOperation.findFirst({
                    where: { status: 'QUEUED' },
                    orderBy: { createdAt: 'asc' },
                }));
            if (!candidate) {
                return null;
            }
            const claimed = await tx.gatewayReleaseOperation.updateMany({
                where:
                    candidate.status === 'QUEUED'
                        ? { id: candidate.id, status: 'QUEUED' }
                        : { id: candidate.id, status: 'RUNNING', leaseUntil: candidate.leaseUntil },
                data: {
                    status: 'RUNNING',
                    startedAt: candidate.startedAt ?? now,
                    completedAt: null,
                    error: null,
                    leaseOwner: lease.ownerId,
                    leaseUntil: new Date(now.getTime() + lease.durationMs),
                    heartbeatAt: now,
                    attempts: { increment: 1 },
                },
            });
            return claimed.count === 1 ? tx.gatewayReleaseOperation.findUnique({ where: { id: candidate.id } }) : null;
        });
        return row ? mapOperation(row) : null;
    },
    async renewOperationLease(id, ownerId, now, durationMs) {
        const updated = await prisma.gatewayReleaseOperation.updateMany({
            where: { id, status: 'RUNNING', leaseOwner: ownerId },
            data: {
                leaseUntil: new Date(now.getTime() + durationMs),
                heartbeatAt: now,
            },
        });
        return updated.count === 1;
    },
    async pinOperationResolvedCommit(id, ownerId, resolvedCommitSha) {
        const updated = await prisma.gatewayReleaseOperation.updateMany({
            where: {
                id,
                status: 'RUNNING',
                leaseOwner: ownerId,
                OR: [{ resolvedCommitSha: null }, { resolvedCommitSha }],
            },
            data: { resolvedCommitSha },
        });
        return updated.count === 1;
    },
    async completeOperation(id, status, fields, leaseOwner) {
        const updated = await prisma.gatewayReleaseOperation.updateMany({
            where: { id, status: 'RUNNING', leaseOwner },
            data: {
                status,
                completedAt: new Date(),
                resolvedCommitSha: fields.resolvedCommitSha,
                error: fields.error,
                leaseOwner: null,
                leaseUntil: null,
                heartbeatAt: null,
            },
        });
        if (updated.count !== 1) {
            throw new Error(`Gateway release lease lost before completion: ${id}`);
        }
        return mapOperation(await prisma.gatewayReleaseOperation.findUniqueOrThrow({ where: { id } }));
    },
    async publishRelease(operationId, leaseOwner, release) {
        const row = await prisma.$transaction(async (tx) => {
            const owned = await tx.gatewayReleaseOperation.findFirst({
                where: { id: operationId, status: 'RUNNING', leaseOwner },
                select: { id: true },
            });
            if (!owned) {
                throw new Error(`Gateway release lease lost before publish: ${operationId}`);
            }
            return tx.gatewayReleaseState.upsert({
                where: { id: 'gateway' },
                create: {
                    id: 'gateway',
                    activeCommitSha: release.commitSha,
                    activeWorkspace: release.workspace,
                    previousCommitSha: release.previousCommitSha,
                    previousWorkspace: release.previousWorkspace,
                    lastSuccessfulAt: new Date(),
                    lastError: null,
                },
                update: {
                    activeCommitSha: release.commitSha,
                    activeWorkspace: release.workspace,
                    previousCommitSha: release.previousCommitSha,
                    previousWorkspace: release.previousWorkspace,
                    lastSuccessfulAt: new Date(),
                    lastError: null,
                },
            });
        });
        return mapState(row);
    },
    async recordStateError(detail) {
        await prisma.gatewayReleaseState.upsert({
            where: { id: 'gateway' },
            create: { id: 'gateway', lastError: detail },
            update: { lastError: detail },
        });
    },
    async cancelOperation(id) {
        const updated = await prisma.gatewayReleaseOperation.updateMany({
            where: { id, status: 'QUEUED' },
            data: { status: 'CANCELLED', completedAt: new Date() },
        });
        return updated.count === 1;
    },
    async retryOperation(id, requestedBy) {
        const row = await prisma.$transaction(async (tx) => {
            const previous = await tx.gatewayReleaseOperation.findUnique({ where: { id } });
            if (!previous || (previous.status !== 'FAILED' && previous.status !== 'CANCELLED')) {
                return null;
            }
            return tx.gatewayReleaseOperation.create({
                data: {
                    type: previous.type,
                    sourceMode: previous.resolvedCommitSha ? 'COMMIT' : previous.sourceMode,
                    sourceRef: previous.resolvedCommitSha ?? previous.sourceRef,
                    payload: previous.payload as GatewayPrisma.JsonObject,
                    reason: previous.reason,
                    requestedBy,
                },
            });
        });
        return row ? mapOperation(row) : null;
    },
});
