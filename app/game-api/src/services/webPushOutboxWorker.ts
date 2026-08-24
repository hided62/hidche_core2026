import { createHmac, randomUUID } from 'node:crypto';

import type { WebPushEventEnvelopeV1, WebPushEventType } from '@sammo-ts/common';
import { GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';

const INTERNAL_TOKEN_CONTEXT = 'sammo:web-push-event-ingest:v1';
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1_000;

const deriveInternalToken = (secret: string): string =>
    createHmac('sha256', secret).update(INTERNAL_TOKEN_CONTEXT).digest('hex');

export interface WebPushOutboxWorkerOptions {
    intervalMs?: number;
    onError?: (error: unknown) => void;
}

export class WebPushOutboxWorker {
    private readonly owner: string;
    private readonly intervalMs: number;
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly onError: (error: unknown) => void;
    private timer: NodeJS.Timeout | null = null;
    private inFlight: Promise<void> | null = null;
    private nextPruneAt = 0;

    constructor(
        private readonly db: GamePrismaClient,
        gatewayInternalApiUrl: string,
        secret: string,
        private readonly profileName: string,
        options: WebPushOutboxWorkerOptions = {}
    ) {
        this.baseUrl = gatewayInternalApiUrl.replace(/\/$/u, '');
        this.token = deriveInternalToken(secret);
        this.owner = `game-web-push:${profileName}:${process.pid}:${randomUUID()}`;
        this.intervalMs = Math.max(250, Math.floor(options.intervalMs ?? 1_000));
        this.onError = options.onError ?? (() => undefined);
    }

    private async dispatchBatch(): Promise<void> {
        const claimed = await this.db.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<Array<{ id: bigint }>>(GamePrisma.sql`
                SELECT "id"
                FROM "web_push_outbox"
                WHERE "delivered_at" IS NULL
                  AND "available_at" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                  AND (
                      "locked_at" IS NULL
                      OR "locked_at" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '30 seconds'
                  )
                ORDER BY "id"
                FOR UPDATE SKIP LOCKED
                LIMIT 50
            `);
            if (rows.length === 0) return [];
            const ids = rows.map((row) => row.id);
            await tx.webPushOutbox.updateMany({
                where: { id: { in: ids } },
                data: { lockedAt: new Date(), lockOwner: this.owner, attempts: { increment: 1 } },
            });
            return tx.webPushOutbox.findMany({
                where: { id: { in: ids }, lockOwner: this.owner },
                orderBy: { id: 'asc' },
            });
        });

        for (const event of claimed) {
            if (event.createdAt.getTime() <= Date.now() - MAX_EVENT_AGE_MS) {
                await this.db.webPushOutbox.updateMany({
                    where: { id: event.id, lockOwner: this.owner },
                    data: { deliveredAt: new Date(), lockedAt: null, lockOwner: null, lastError: null },
                });
                continue;
            }
            try {
                const envelope: WebPushEventEnvelopeV1 = {
                    version: 1,
                    eventId: `game:${this.profileName}:${event.eventId}`,
                    eventType: event.eventType as WebPushEventType,
                    profileName: this.profileName,
                    userIds: event.userIds,
                    ...(event.year == null ? {} : { year: event.year }),
                    ...(event.month == null ? {} : { month: event.month }),
                    occurredAt: event.createdAt.toISOString(),
                };
                const response = await fetch(`${this.baseUrl}/internal/web-push-events`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-sammo-internal-token': this.token,
                    },
                    body: JSON.stringify(envelope),
                    signal: AbortSignal.timeout(5_000),
                });
                if (!response.ok) throw new Error(`Gateway web push ingest failed with HTTP ${response.status}.`);
                await this.db.webPushOutbox.updateMany({
                    where: { id: event.id, lockOwner: this.owner },
                    data: { deliveredAt: new Date(), lockedAt: null, lockOwner: null, lastError: null },
                });
            } catch (error) {
                const attempts = event.attempts;
                const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
                await this.db.webPushOutbox.updateMany({
                    where: { id: event.id, lockOwner: this.owner },
                    data: {
                        availableAt: new Date(Date.now() + delaySeconds * 1_000),
                        lockedAt: null,
                        lockOwner: null,
                        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
                    },
                });
                this.onError(error);
            }
        }
        if (Date.now() >= this.nextPruneAt) {
            this.nextPruneAt = Date.now() + 60_000;
            await this.db.$executeRaw(GamePrisma.sql`
                WITH expired AS (
                    SELECT "id"
                    FROM "web_push_outbox"
                    WHERE "delivered_at" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 day'
                    ORDER BY "id"
                    LIMIT 500
                )
                DELETE FROM "web_push_outbox"
                WHERE "id" IN (SELECT "id" FROM expired)
            `);
        }
    }

    private run(): void {
        if (this.inFlight) return;
        this.inFlight = this.dispatchBatch()
            .catch(this.onError)
            .finally(() => {
                this.inFlight = null;
            });
    }

    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.run(), this.intervalMs);
        this.timer.unref?.();
        this.run();
    }

    wake(): void {
        this.run();
    }

    async stop(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        await this.inFlight;
    }
}
