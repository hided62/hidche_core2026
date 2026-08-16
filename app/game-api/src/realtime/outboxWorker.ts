import { randomUUID } from 'node:crypto';
import {
    readModelOutboxPayloadToChanges,
    type ReadModelDomain,
} from '@sammo-ts/common';
import {
    dispatchReadModelOutboxBatch,
    pruneDeliveredReadModelOutbox,
    type ReadModelOutboxDatabase,
    type ReadModelOutboxDispatchResult,
    type RedisConnector,
} from '@sammo-ts/infra';

import { publishRealtimeReadModelChanges } from './publisher.js';

// access.general is an authoritative DB-only source revision. Tournament and
// betting still have separate Redis-owned source revisions. None of the three
// should wake the legacy dashboard channel solely because its outbox row ran.
const NON_DASHBOARD_DOMAINS: ReadonlySet<ReadModelDomain> = new Set([
    'access.general',
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
        this.pruneLimit = normalizePositiveInteger(options.pruneLimit, 100);
        this.owner = options.owner ?? `game-api:${profileName}:${process.pid}:${randomUUID()}`;
        this.now = options.now ?? (() => new Date());
        this.onError = options.onError ?? (() => undefined);
        this.nextPruneAt = this.now().getTime() + this.pruneIntervalMs;
    }

    private async dispatchOnce(): Promise<ReadModelOutboxDispatchResult> {
        const result = await dispatchReadModelOutboxBatch(
            this.db,
            async (payload) => {
                if (payload.changes.every(([domain]) => NON_DASHBOARD_DOMAINS.has(domain))) {
                    return;
                }
                const changes = readModelOutboxPayloadToChanges(payload);
                await publishRealtimeReadModelChanges(this.redis, this.profileName, changes);
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
            this.nextPruneAt = now.getTime() + this.pruneIntervalMs;
            await pruneDeliveredReadModelOutbox(this.db, {
                deliveredBefore: new Date(now.getTime() - this.retentionMs),
                limit: this.pruneLimit,
            });
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
