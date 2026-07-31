import { isCanonicalIsoTimestamp, isRecord, type AccountIconProjection } from '@sammo-ts/common';

import type { AccountIconResetProjection, AccountIconResetSource } from '../auth/accountIconSource.js';
import type { DatabaseClient } from '../context.js';
import type { TurnDaemonTransport } from '../daemon/transport.js';

const BATCH_SIZE = 500;
const MAX_TERMINAL_REQUEUES = 3;

type GeneralIconState = {
    id: number;
    userId: string | null;
    picture: string | null;
    imageServer: number;
    meta: unknown;
};

export type AccountIconResetReconcilerHealth = {
    running: boolean;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
};

const readCurrentRevision = (meta: unknown): string | null => {
    if (!isRecord(meta)) {
        return null;
    }
    const value = meta.accountIconUpdatedAt;
    return typeof value === 'string' && isCanonicalIsoTimestamp(value) ? value : null;
};

const projectionForGeneral = (general: GeneralIconState, reset: AccountIconResetProjection): AccountIconProjection => {
    const currentRevision = readCurrentRevision(general.meta);
    if (currentRevision) {
        return {
            revision: reset.resetRevision,
            picture: 'default.jpg',
            imageServer: 0,
        };
    }

    // Existing installations have no per-General watermark. If the rendered
    // tuple already equals a post-reset Gateway projection, seed that newer
    // revision instead of replaying the historical reset over it.
    if (
        reset.current.revision > reset.resetRevision &&
        general.picture === reset.current.picture &&
        general.imageServer === reset.current.imageServer
    ) {
        return reset.current;
    }
    return {
        revision: reset.resetRevision,
        picture: 'default.jpg',
        imageServer: 0,
    };
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const stableJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
};

export class AccountIconResetReconciler {
    private timer: NodeJS.Timeout | null = null;
    private inFlight: Promise<void> | null = null;
    private lastSuccessAt: string | null = null;
    private lastErrorAt: string | null = null;
    private lastError: string | null = null;

    constructor(
        private readonly db: DatabaseClient,
        private readonly source: AccountIconResetSource,
        private readonly turnDaemon: TurnDaemonTransport,
        private readonly intervalMs: number,
        private readonly onError: (error: unknown) => void = () => undefined
    ) {}

    getHealth(): AccountIconResetReconcilerHealth {
        return {
            running: this.timer !== null,
            lastSuccessAt: this.lastSuccessAt,
            lastErrorAt: this.lastErrorAt,
            lastError: this.lastError,
        };
    }

    private async sendWithTerminalRecovery(userId: string, projection: AccountIconProjection): Promise<void> {
        const baseRequestId = `general:adjustIcon:${userId}:${projection.revision}`;
        const events = await this.db.inputEvent.findMany({
            where: {
                OR: [{ requestId: baseRequestId }, { requestId: { startsWith: `${baseRequestId}:retry:` } }],
            },
            select: {
                requestId: true,
                status: true,
                eventType: true,
                payload: true,
            },
            orderBy: { sequence: 'asc' },
        });
        const latest = events.at(-1);
        if (latest) {
            const expected = {
                type: 'adjustGeneralIcon',
                requestId: latest.requestId,
                userId,
                picture: projection.picture,
                imageServer: projection.imageServer,
                iconRevision: projection.revision,
            };
            if (latest.eventType !== 'adjustGeneralIcon' || stableJson(latest.payload) !== stableJson(expected)) {
                throw new Error('account icon reset event payload conflicts with the durable journal');
            }
        }
        if (latest?.status === 'PENDING' || latest?.status === 'PROCESSING') {
            return;
        }

        const retryCount = events.filter(({ requestId }) => requestId !== baseRequestId).length;
        if (latest && retryCount >= MAX_TERMINAL_REQUEUES) {
            throw new Error(`account icon reset exhausted ${MAX_TERMINAL_REQUEUES} terminal retries`);
        }
        const requestId = latest ? `${baseRequestId}:retry:${retryCount + 1}` : baseRequestId;
        await this.turnDaemon.sendCommand({
            type: 'adjustGeneralIcon',
            requestId,
            userId,
            picture: projection.picture,
            imageServer: projection.imageServer,
            iconRevision: projection.revision,
        });
    }

    private async reconcilePage(generals: GeneralIconState[]): Promise<Error[]> {
        const userIds = [...new Set(generals.flatMap((general) => (general.userId ? [general.userId] : [])))];
        if (userIds.length === 0) {
            return [];
        }
        const resets = await this.source.listResets(userIds);
        const resetByUserId = new Map(resets.map((reset) => [reset.userId, reset]));
        const failures: Error[] = [];

        for (const general of generals) {
            if (!general.userId) continue;
            const reset = resetByUserId.get(general.userId);
            if (!reset) continue;
            const currentRevision = readCurrentRevision(general.meta);
            if (currentRevision && currentRevision >= reset.resetRevision) {
                continue;
            }
            try {
                await this.sendWithTerminalRecovery(general.userId, projectionForGeneral(general, reset));
            } catch (error) {
                failures.push(
                    new Error(`account icon reset failed for user ${general.userId}: ${errorMessage(error)}`, {
                        cause: error,
                    })
                );
            }
        }
        return failures;
    }

    async reconcileOnce(): Promise<void> {
        const failures: Error[] = [];
        let cursorId: number | null = null;
        try {
            while (true) {
                const generals: GeneralIconState[] = await this.db.general.findMany({
                    where: {
                        userId: { not: null },
                        npcState: 0,
                    },
                    select: {
                        id: true,
                        userId: true,
                        picture: true,
                        imageServer: true,
                        meta: true,
                    },
                    orderBy: { id: 'asc' },
                    take: BATCH_SIZE,
                    ...(cursorId === null ? {} : { cursor: { id: cursorId }, skip: 1 }),
                });
                failures.push(...(await this.reconcilePage(generals)));
                if (generals.length < BATCH_SIZE) break;
                cursorId = generals.at(-1)?.id ?? null;
                if (cursorId === null) break;
            }
            if (failures.length > 0) {
                throw new AggregateError(failures, `${failures.length} account icon reset reconciliation(s) failed`);
            }
            this.lastSuccessAt = new Date().toISOString();
            this.lastErrorAt = null;
            this.lastError = null;
        } catch (error) {
            this.lastErrorAt = new Date().toISOString();
            this.lastError = errorMessage(error);
            throw error;
        }
    }

    start(): void {
        if (this.timer) {
            return;
        }
        const run = (): void => {
            if (this.inFlight) {
                return;
            }
            this.inFlight = this.reconcileOnce()
                .catch((error: unknown) => this.onError(error))
                .finally(() => {
                    this.inFlight = null;
                });
        };
        run();
        this.timer = setInterval(run, this.intervalMs);
        this.timer.unref?.();
    }

    async stop(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        await this.inFlight;
    }
}
