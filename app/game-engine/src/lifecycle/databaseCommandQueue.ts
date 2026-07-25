import { randomUUID } from 'node:crypto';
import { GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';

import { normalizeTurnDaemonCommand } from '../turn/commandRegistry.js';
import type {
    TurnDaemonCommand,
    TurnDaemonCommandResponder,
    TurnDaemonCommandResult,
    TurnDaemonControlQueue,
    TurnDaemonStatus,
} from './types.js';

const asJson = (value: unknown): GamePrisma.InputJsonValue => value as GamePrisma.InputJsonValue;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class DatabaseTurnDaemonCommandQueue implements TurnDaemonControlQueue, TurnDaemonCommandResponder {
    private readonly localQueue: TurnDaemonCommand[] = [];
    private readonly workerId = randomUUID();
    private readonly leaseDurationMs = 60_000;

    constructor(private readonly db: GamePrismaClient) {}

    async initialize(): Promise<void> {
        await this.recoverExpiredLeases();
    }

    enqueue(command: TurnDaemonCommand): void {
        this.localQueue.push(command);
    }

    async drain(): Promise<TurnDaemonCommand[]> {
        const local = this.localQueue.splice(0, this.localQueue.length);
        const remote = await this.claimPending();
        return local.concat(remote);
    }

    async waitUntil(deadlineMs: number | null): Promise<TurnDaemonCommand | null> {
        while (deadlineMs === null || Date.now() < deadlineMs) {
            const local = this.localQueue.shift();
            if (local) {
                return local;
            }
            const remote = await this.claimPending(1);
            if (remote[0]) {
                return remote[0];
            }
            const remaining = deadlineMs === null ? 100 : Math.max(1, Math.min(100, deadlineMs - Date.now()));
            await delay(remaining);
        }
        return null;
    }

    getDepth(): number {
        return this.localQueue.length;
    }

    async publishStatus(requestId: string, status: TurnDaemonStatus): Promise<void> {
        await this.complete(requestId, { status });
    }

    async publishCommandResult(requestId: string, result: TurnDaemonCommandResult): Promise<void> {
        await this.complete(requestId, result);
    }

    private async claimPending(limit = 100): Promise<TurnDaemonCommand[]> {
        await this.recoverExpiredLeases();
        return this.db.$transaction(async (transaction) => {
            const rows = await transaction.$queryRaw<
                Array<{
                    sequence: bigint;
                    requestId: string;
                    eventType: string;
                    payload: unknown;
                    createdAt: Date;
                }>
            >(GamePrisma.sql`
                SELECT
                    "sequence",
                    "request_id" AS "requestId",
                    "event_type" AS "eventType",
                    "payload",
                    "created_at" AS "createdAt"
                FROM "input_event"
                WHERE "target" = 'ENGINE'::"InputEventTarget"
                  AND "status" = 'PENDING'::"InputEventStatus"
                ORDER BY "sequence" ASC
                FOR UPDATE SKIP LOCKED
                LIMIT ${limit}
            `);
            if (rows.length === 0) {
                return [];
            }
            await transaction.inputEvent.updateMany({
                where: {
                    sequence: { in: rows.map((row) => row.sequence) },
                    target: 'ENGINE',
                    status: 'PENDING',
                },
                data: {
                    status: 'PROCESSING',
                    processingAt: new Date(),
                    lockedBy: this.workerId,
                    leaseUntil: new Date(Date.now() + this.leaseDurationMs),
                    attempts: { increment: 1 },
                },
            });

            const commands: TurnDaemonCommand[] = [];
            for (const row of rows) {
                const command = normalizeTurnDaemonCommand({
                    requestId: row.requestId,
                    sentAt: row.createdAt.toISOString(),
                    command: row.payload as TurnDaemonCommand,
                });
                if (!command) {
                    await transaction.inputEvent.update({
                        where: { sequence: row.sequence },
                        data: {
                            status: 'FAILED',
                            error: `Invalid command payload for ${row.eventType}`,
                            completedAt: new Date(),
                            lockedBy: null,
                            leaseUntil: null,
                        },
                    });
                    continue;
                }
                commands.push(command);
            }
            return commands;
        });
    }

    private async complete(requestId: string, result: unknown): Promise<void> {
        await this.db.inputEvent.update({
            where: { requestId },
            data: {
                status: 'SUCCEEDED',
                result: asJson(result),
                completedAt: new Date(),
                error: null,
                lockedBy: null,
                leaseUntil: null,
            },
        });
    }

    private async recoverExpiredLeases(): Promise<void> {
        const now = new Date();
        await this.db.inputEvent.updateMany({
            where: {
                target: 'ENGINE',
                status: 'PROCESSING',
                leaseUntil: { lt: now },
            },
            data: {
                status: 'PENDING',
                processingAt: null,
                lockedBy: null,
                leaseUntil: null,
            },
        });
    }
}
