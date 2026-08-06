import { randomUUID } from 'node:crypto';

import type { GatewayPrisma, GatewayPrismaClient } from '@sammo-ts/infra';

export type AdminAuditOutcome = 'STARTED' | 'SUCCEEDED' | 'FAILED';

export interface AdminAuditEventRecord {
    id: string;
    correlationId: string;
    actorUserId: string;
    actorUsername: string;
    credentialKind: string;
    capability?: string;
    scope?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    profileName?: string;
    reason?: string;
    outcome: AdminAuditOutcome;
    summary: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
    createdAt: string;
}

export interface AdminAuditWrite {
    correlationId: string;
    actorUserId: string;
    actorUsername: string;
    capability?: string;
    scope?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    profileName?: string;
    reason?: string;
    outcome: AdminAuditOutcome;
    summary?: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
}

export interface AdminAuditStore {
    append(event: AdminAuditWrite): Promise<void>;
    list(input?: {
        actorUserId?: string;
        targetType?: string;
        targetId?: string;
        profileName?: string;
        limit?: number;
    }): Promise<AdminAuditEventRecord[]>;
}

type AuditDelegate = {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
};

const asAuditDelegate = (prisma: GatewayPrismaClient): AuditDelegate | null => {
    const delegate = (prisma as unknown as { adminAuditEvent?: AuditDelegate }).adminAuditEvent;
    return delegate ?? null;
};

const toRecord = (row: Record<string, unknown>): AdminAuditEventRecord => ({
    id: String(row.id),
    correlationId: String(row.correlationId),
    actorUserId: String(row.actorUserId),
    actorUsername: String(row.actorUsername),
    credentialKind: String(row.credentialKind),
    ...(typeof row.capability === 'string' ? { capability: row.capability } : {}),
    ...(typeof row.scope === 'string' ? { scope: row.scope } : {}),
    action: String(row.action),
    ...(typeof row.targetType === 'string' ? { targetType: row.targetType } : {}),
    ...(typeof row.targetId === 'string' ? { targetId: row.targetId } : {}),
    ...(typeof row.profileName === 'string' ? { profileName: row.profileName } : {}),
    ...(typeof row.reason === 'string' ? { reason: row.reason } : {}),
    outcome: row.outcome as AdminAuditOutcome,
    summary:
        row.summary && typeof row.summary === 'object' && !Array.isArray(row.summary)
            ? (row.summary as Record<string, unknown>)
            : {},
    ...(typeof row.errorCode === 'string' ? { errorCode: row.errorCode } : {}),
    ...(typeof row.errorMessage === 'string' ? { errorMessage: row.errorMessage } : {}),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
});

export const createAdminAuditStore = (prisma: GatewayPrismaClient): AdminAuditStore => ({
    async append(event) {
        const delegate = asAuditDelegate(prisma);
        // Partial Prisma mocks in router tests intentionally omit the audit model.
        if (!delegate) return;
        await delegate.create({
            data: {
                ...event,
                summary: (event.summary ?? {}) as GatewayPrisma.JsonObject,
            },
        });
    },
    async list(input = {}) {
        const delegate = asAuditDelegate(prisma);
        if (!delegate) return [];
        const rows = await delegate.findMany({
            where: {
                ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
                ...(input.targetType ? { targetType: input.targetType } : {}),
                ...(input.targetId ? { targetId: input.targetId } : {}),
                ...(input.profileName ? { profileName: input.profileName } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: Math.min(Math.max(input.limit ?? 100, 1), 200),
        });
        return rows.map(toRecord);
    },
});

const REDACTED_KEYS = /password|credential|token|secret|oauth|authorization|email/i;

export const sanitizeAdminAuditValue = (value: unknown, depth = 0): unknown => {
    if (depth > 4) return '[DEPTH_LIMIT]';
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
    if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeAdminAuditValue(entry, depth + 1));
    if (!value || typeof value !== 'object') return String(value);
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 80)) {
        result[key] = REDACTED_KEYS.test(key) ? '[REDACTED]' : sanitizeAdminAuditValue(entry, depth + 1);
    }
    return result;
};

export const buildAdminAuditTarget = (
    rawInput: unknown
): {
    targetType?: string;
    targetId?: string;
    profileName?: string;
    reason?: string;
    scope?: string;
    summary: Record<string, unknown>;
} => {
    const input =
        rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
            ? (rawInput as Record<string, unknown>)
            : {};
    const userId = typeof input.userId === 'string' ? input.userId : undefined;
    const profileName = typeof input.profileName === 'string' ? input.profileName : undefined;
    const operationId = typeof input.id === 'string' ? input.id : undefined;
    const reason = typeof input.reason === 'string' ? input.reason : undefined;
    return {
        ...(userId
            ? { targetType: 'USER', targetId: userId }
            : profileName
              ? { targetType: 'PROFILE', targetId: profileName }
              : operationId
                ? { targetType: 'OPERATION', targetId: operationId }
                : {}),
        ...(profileName ? { profileName, scope: profileName } : {}),
        ...(reason ? { reason } : {}),
        summary: sanitizeAdminAuditValue(input) as Record<string, unknown>,
    };
};

export const newAdminAuditCorrelationId = (): string => randomUUID();
