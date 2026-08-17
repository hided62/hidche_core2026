import { createGatewayPostgresConnector } from '@sammo-ts/infra';
import { isRecord } from '@sammo-ts/common';

export type GatewayAdminActionStatus = 'REQUESTED' | 'PARTIAL' | 'APPLIED' | 'FAILED' | 'IGNORED';

export interface GatewayAdminActionRecord {
    id?: string;
    profileName?: string;
    action?: string;
    requestedAt?: string;
    durationMinutes?: number | null;
    scheduledAt?: string | null;
    reason?: string | null;
    status?: GatewayAdminActionStatus | string | null;
    handledAt?: string | null;
    handler?: string | null;
    detail?: string | null;
    payload?: Record<string, unknown>;
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
        openAt?: string | null;
        preopenAt?: string | null;
        gitRef?: string | null;
    };
}

export interface GatewayAdminActionResult {
    status: GatewayAdminActionStatus;
    detail?: string;
}

export interface GatewayAdminActionConsumerOptions {
    databaseUrl: string;
    gatewayDatabaseUrl?: string;
    profileName: string;
    pollIntervalMs?: number;
    handler: (action: GatewayAdminActionRecord) => Promise<GatewayAdminActionResult>;
    onActionApplied?: (action: GatewayAdminActionRecord, result: GatewayAdminActionResult) => Promise<void>;
}

export interface GatewayAdminActionConsumer {
    start(): void;
    stop(): Promise<void>;
}

const DEFAULT_POLL_MS = 5000;

const normalizeMeta = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const normalizeStatus = (value: unknown): GatewayAdminActionStatus | null => {
    if (typeof value === 'string') {
        return value as GatewayAdminActionStatus;
    }
    return null;
};

const buildActionKey = (action: GatewayAdminActionRecord): string =>
    [action.action ?? '', action.requestedAt ?? '', action.scheduledAt ?? '', action.reason ?? ''].join('|');

export const createGatewayAdminActionConsumer = async (
    options: GatewayAdminActionConsumerOptions
): Promise<GatewayAdminActionConsumer> => {
    const connector = createGatewayPostgresConnector({
        url: options.gatewayDatabaseUrl ?? options.databaseUrl,
    });
    await connector.connect();
    const prisma = connector.prisma;

    let timer: NodeJS.Timeout | null = null;
    let inFlight = false;

    const pollRuntimeActions = async (): Promise<void> => {
        const pending = await prisma.gatewayRuntimeAction.findMany({
            where: {
                profileName: options.profileName,
                status: { in: ['REQUESTED', 'PARTIAL'] },
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
            },
            orderBy: { createdAt: 'asc' },
        });
        for (const action of pending) {
            const actionRecord: GatewayAdminActionRecord = {
                id: action.id,
                profileName: action.profileName,
                action: action.action,
                requestedAt: action.createdAt.toISOString(),
                durationMinutes: action.durationMinutes,
                scheduledAt: action.scheduledAt?.toISOString() ?? null,
                reason: action.reason,
                status: action.status,
                handledAt: action.handledAt?.toISOString() ?? null,
                handler: action.handler,
                detail: action.detail,
                payload: normalizeMeta(action.payload),
            };
            let result: GatewayAdminActionResult;
            try {
                result = await options.handler(actionRecord);
            } catch (error) {
                result = {
                    status: 'PARTIAL',
                    detail: error instanceof Error ? error.message : String(error),
                };
            }
            if (result.status === 'REQUESTED') {
                continue;
            }
            const terminal = result.status !== 'PARTIAL';
            const updated = await prisma.gatewayRuntimeAction.updateMany({
                where: {
                    id: action.id,
                    status: { in: ['REQUESTED', 'PARTIAL'] },
                },
                data: {
                    status: result.status,
                    detail: result.detail ?? null,
                    handler: 'turn-daemon',
                    handledAt: terminal ? new Date() : null,
                    attempts: { increment: 1 },
                    nextAttemptAt: terminal
                        ? null
                        : new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(action.attempts, 6))),
                },
            });
            if (terminal && updated.count > 0) {
                await options.onActionApplied?.(actionRecord, result);
            }
        }
    };

    const pollOnce = async (): Promise<void> => {
        if (inFlight) {
            return;
        }
        inFlight = true;
        try {
            await pollRuntimeActions();
            const profile = await prisma.gatewayProfile.findUnique({
                where: { profileName: options.profileName },
            });
            if (!profile) {
                return;
            }
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
            const appliedActions: Array<{
                action: GatewayAdminActionRecord;
                result: GatewayAdminActionResult;
            }> = [];

            for (const action of pending) {
                const key = buildActionKey(action);
                try {
                    const result = await options.handler(action);
                    if (result.status !== 'REQUESTED') {
                        updates.set(key, {
                            status: result.status,
                            detail: result.detail,
                            handledAt: new Date().toISOString(),
                        });
                        appliedActions.push({ action, result });
                    }
                } catch (error) {
                    updates.set(key, {
                        status: 'FAILED',
                        detail: error instanceof Error ? error.message : String(error),
                        handledAt: new Date().toISOString(),
                    });
                    appliedActions.push({
                        action,
                        result: {
                            status: 'FAILED',
                            detail: error instanceof Error ? error.message : String(error),
                        },
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
                    handler: action.handler ?? 'turn-daemon',
                    detail: update.detail ?? action.detail ?? null,
                };
            });

            await prisma.gatewayProfile.update({
                where: { profileName: options.profileName },
                data: {
                    meta: {
                        ...meta,
                        adminActions: nextActions,
                        adminActionsUpdatedAt: new Date().toISOString(),
                    },
                },
            });

            if (options.onActionApplied) {
                for (const applied of appliedActions) {
                    await options.onActionApplied(applied.action, applied.result);
                }
            }
        } finally {
            inFlight = false;
        }
    };

    const start = (): void => {
        if (timer) {
            return;
        }
        timer = setInterval(() => void pollOnce(), options.pollIntervalMs ?? DEFAULT_POLL_MS);
        void pollOnce();
    };

    const stop = async (): Promise<void> => {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        while (inFlight) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await connector.disconnect();
    };

    return {
        start,
        stop,
    };
};
