import { randomUUID } from 'node:crypto';
import {
    readModelOutboxPayloadToDiplomacyMailboxes,
    readModelOutboxPayloadToChanges,
    readModelOutboxPayloadToMessageMailboxes,
    type ReadModelDomain,
} from '@sammo-ts/common';
import {
    dispatchReadModelOutboxBatch,
    pruneDeliveredReadModelOutbox,
    type ReadModelOutboxDatabase,
    type ReadModelOutboxDispatchResult,
    type RedisConnector,
} from '@sammo-ts/infra';

import { publishRealtimeMessageChanges, publishRealtimeReadModelChanges } from './publisher.js';

// Source-only/access keys and separately owned tournament/betting state must
// not wake the legacy dashboard channel solely because an outbox row ran.
const NON_DASHBOARD_DOMAINS: ReadonlySet<ReadModelDomain> = new Set([
    'access.general',
    'dashboard.global',
    'messages.mailbox',
    'messages.diplomacyMailbox',
    'tournament',
    'betting',
]);

export interface ReadModelOutboxWakeup {
    wake(): void;
}

export interface ReadModelOutboxWorkerOptions {
    intervalMs?: number;
    batchSize?: number;
    leaseMs?: number;
    retentionMs?: number;
    pruneIntervalMs?: number;
    pruneLimit?: number;
    owner?: string;
    now?: () => Date;
    onError?: (error: unknown) => void;
}

const normalizePositiveInteger = (value: number | undefined, fallback: number): number =>
    Math.max(1, Math.floor(value ?? fallback));

/**
 * Polls the durable API/engine outbox without overlapping batches. `wake()` is
 * only a scheduling hint; delivery always reclaims committed PostgreSQL rows.
 */
export class ReadModelOutboxWorker implements ReadModelOutboxWakeup {
    private timer: NodeJS.Timeout | null = null;
    private inFlight: Promise<void> | null = null;
    private rerunRequested = false;
    private running = false;
    private readonly intervalMs: number;
    private readonly batchSize: number;
    private readonly leaseMs: number;
    private readonly retentionMs: number;
    private readonly pruneIntervalMs: number;
    private readonly pruneLimit: number;
    private readonly owner: string;
    private readonly now: () => Date;
    private readonly onError: (error: unknown) => void;
    private nextPruneAt: number;

    constructor(
        private readonly db: ReadModelOutboxDatabase,
        private readonly redis: RedisConnector['client'],
        private readonly profileName: string,
        options: ReadModelOutboxWorkerOptions = {}
    ) {
        this.intervalMs = normalizePositiveInteger(options.intervalMs, 1_000);
        this.batchSize = normalizePositiveInteger(options.batchSize, 50);
        this.leaseMs = normalizePositiveInteger(options.leaseMs, 30_000);
        this.retentionMs = normalizePositiveInteger(options.retentionMs, 24 * 60 * 60 * 1_000);
        this.pruneIntervalMs = normalizePositiveInteger(options.pruneIntervalMs, 60_000);
        this.pruneLimit = Math.min(500, normalizePositiveInteger(options.pruneLimit, 500));
        this.owner = options.owner ?? `game-api:${profileName}:${process.pid}:${randomUUID()}`;
        this.now = options.now ?? (() => new Date());
        this.onError = options.onError ?? (() => undefined);
        this.nextPruneAt = this.now().getTime() + this.pruneIntervalMs;
    }

    private async dispatchOnce(): Promise<ReadModelOutboxDispatchResult> {
        const result = await dispatchReadModelOutboxBatch(
            this.db,
            async (payload) => {
                const mailboxes = readModelOutboxPayloadToMessageMailboxes(payload);
                const diplomacyMailboxes = readModelOutboxPayloadToDiplomacyMailboxes(payload);
                if (mailboxes.length > 0 || diplomacyMailboxes.length > 0) {
                    await publishRealtimeMessageChanges(this.redis, this.profileName, mailboxes, diplomacyMailboxes);
                }
                if (payload.changes.some(([domain]) => !NON_DASHBOARD_DOMAINS.has(domain))) {
                    const changes = readModelOutboxPayloadToChanges(payload);
                    await publishRealtimeReadModelChanges(this.redis, this.profileName, changes);
                }
            },
            {
                owner: this.owner,
                limit: this.batchSize,
                leaseMs: this.leaseMs,
            }
        );
        if (result.failed > 0) {
            this.reportError(new Error(`${result.failed} read-model outbox delivery attempt(s) failed.`));
        }

        const now = this.now();
        if (now.getTime() >= this.nextPruneAt) {
            // backlog가 있으면 다음 dispatch에서도 이어서 정리한다. 평상시에는 낮은 빈도로 확인한다.
            // 한 호출은 최대 10 batch/50ms이며 각 SQL도 최대 500행이다.
            const started = performance.now();
            for (let batch = 0; batch < 10; batch += 1) {
                const deleted = await pruneDeliveredReadModelOutbox(this.db, {
                    deliveredBefore: new Date(now.getTime() - this.retentionMs),
                    limit: this.pruneLimit,
                });
                this.nextPruneAt = deleted < this.pruneLimit ? now.getTime() + this.pruneIntervalMs : 0;
                if (deleted < this.pruneLimit || performance.now() - started >= 50) break;
            }
        }
        return result;
    }

    private reportError(error: unknown): void {
        try {
            this.onError(error);
        } catch {
            // Observability callbacks must not stop durable retry polling.
        }
    }

    private runScheduledBatch(): void {
        if (!this.running || this.inFlight) {
            return;
        }
        this.rerunRequested = false;
        this.inFlight = this.dispatchOnce()
            .then(() => undefined)
            .catch((error: unknown) => this.reportError(error))
            .finally(() => {
                this.inFlight = null;
                if (this.running && this.rerunRequested) {
                    this.runScheduledBatch();
                }
            });
    }

    start(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.timer = setInterval(() => this.wake(), this.intervalMs);
        this.timer.unref?.();
        this.wake();
    }

    wake(): void {
        if (!this.running) {
            return;
        }
        this.rerunRequested = true;
        this.runScheduledBatch();
    }

    async stop(): Promise<void> {
        this.running = false;
        this.rerunRequested = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        await this.inFlight;
    }
}
