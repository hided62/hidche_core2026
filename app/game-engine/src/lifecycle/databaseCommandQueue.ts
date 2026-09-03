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
    private readonly maxAttempts = 3;

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

    async publishCommandError(requestId: string, error: unknown): Promise<void> {
        const message = error instanceof Error ? error.message : 'Unknown command error.';
        await this.db.$transaction(async (transaction) => {
            const event = await transaction.inputEvent.findUnique({
                where: { requestId },
                select: {
                    status: true,
                    target: true,
                    lockedBy: true,
                    attempts: true,
                },
            });
            if (
                !event ||
                event.target !== 'ENGINE' ||
                event.status !== 'PROCESSING' ||
                event.lockedBy !== this.workerId
            ) {
                return;
            }
            const terminal = event.attempts >= this.maxAttempts;
            await transaction.inputEvent.updateMany({
                where: {
                    requestId,
                    target: 'ENGINE',
                    status: 'PROCESSING',
                    lockedBy: this.workerId,
                    attempts: event.attempts,
                },
                data: {
                    status: terminal ? 'FAILED' : 'PENDING',
                    processingAt: null,
                    lockedBy: null,
                    leaseUntil: null,
                    completedAt: terminal ? new Date() : null,
                    result: GamePrisma.DbNull,
                    error: message,
                },
            });
        });
    }

    private async claimPending(limit = 100): Promise<TurnDaemonCommand[]> {
        await this.recoverExpiredLeases();
        return this.db.$transaction(async (transaction) => {
            const world = await transaction.worldState.findFirst({
                orderBy: { id: 'asc' },
                select: { clockPhase: true, clockRevision: true, deadlineGeneration: true, clockTick: true },
            });
            const gameplayAllowed = !world || world.clockPhase === 'RUNNING' || world.clockPhase === 'MANUAL';
            const currentRevision = world?.clockRevision ?? null;
            const rows = await transaction.$queryRaw<
                Array<{
                    sequence: bigint;
                    requestId: string;
                    eventType: string;
                    payload: unknown;
                    createdAt: Date;
                    acceptedGameTick: bigint | null;
                    acceptedClockRevision: bigint | null;
                    acceptedDeadlineGeneration: bigint | null;
                }>
            >(GamePrisma.sql`
                SELECT
                    "sequence",
                    "request_id" AS "requestId",
                    "event_type" AS "eventType",
                    "payload",
                    "created_at" AS "createdAt",
                    "accepted_game_tick" AS "acceptedGameTick",
                    "accepted_clock_revision" AS "acceptedClockRevision",
                    "accepted_deadline_generation" AS "acceptedDeadlineGeneration"
                FROM "input_event"
                WHERE "target" = 'ENGINE'::"InputEventTarget"
                  AND "status" = 'PENDING'::"InputEventStatus"
                  AND (
                      ${gameplayAllowed}
                      OR "event_type" = 'getStatus'
                      OR (
                          ${world?.clockPhase === 'SUSPENDED'}
                          AND "event_type" = 'messageRespond'
                          AND "payload" ->> 'messageId' ~ '^[1-9][0-9]*$'
                          AND EXISTS (
                              SELECT 1
                              FROM "message" AS pending_message
                              WHERE pending_message."id" = ("input_event"."payload" ->> 'messageId')::integer
                                AND pending_message."message" #>> '{option,action}' = 'raiseInvader'
                          )
                          AND EXISTS (
                              SELECT 1
                              FROM "clock_suspension" AS active_suspension
                              WHERE active_suspension."status" = 'SUSPENDED'
                                AND active_suspension."source" = 'UNIFICATION_WAIT'
                                AND active_suspension."source_revision" = ${currentRevision}
                          )
                      )
                  )
                ORDER BY "sequence" ASC
                FOR UPDATE SKIP LOCKED
                LIMIT ${limit}
            `);
            if (rows.length === 0) {
                return [];
            }
            const appliedSuspensions = currentRevision
                ? await transaction.clockSuspension.findMany({
                      where: { status: 'APPLIED', targetRevision: { lte: currentRevision } },
                      orderBy: { sourceRevision: 'asc' },
                      select: { sourceRevision: true, targetRevision: true, shiftTicks: true },
                  })
                : [];
            const convertTick = (row: (typeof rows)[number]): bigint | null | undefined => {
                if (row.eventType === 'getStatus') return row.acceptedGameTick;
                if (row.acceptedGameTick === null || row.acceptedClockRevision === null || currentRevision === null) {
                    return row.acceptedGameTick ?? world?.clockTick ?? null;
                }
                if (row.acceptedClockRevision > currentRevision) return undefined;
                let revision = row.acceptedClockRevision;
                let tick = row.acceptedGameTick;
                while (revision < currentRevision) {
                    const step = appliedSuspensions.find((entry) => entry.sourceRevision === revision);
                    if (!step || step.shiftTicks === null || step.targetRevision !== revision + 1n) return undefined;
                    tick += step.shiftTicks;
                    revision = step.targetRevision;
                }
                return tick;
            };
            const processableRows = rows
                .map((row) => ({ row, processingGameTick: convertTick(row) }))
                .filter(
                    (entry): entry is { row: (typeof rows)[number]; processingGameTick: bigint | null } =>
                        entry.processingGameTick !== undefined
                );
            for (const { row, processingGameTick } of processableRows) {
                await transaction.inputEvent.update({
                    where: { sequence: row.sequence },
                    data: {
                        status: 'PROCESSING',
                        processingAt: new Date(),
                        processingGameTick,
                        processingClockRevision: currentRevision,
                        processingDeadlineGeneration: world?.deadlineGeneration ?? null,
                        lockedBy: this.workerId,
                        leaseUntil: new Date(Date.now() + this.leaseDurationMs),
                        attempts: { increment: 1 },
                    },
                });
            }

            const commands: TurnDaemonCommand[] = [];
            for (const { row, processingGameTick } of processableRows) {
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
                if (
                    processingGameTick !== null &&
                    row.acceptedGameTick !== null &&
                    processingGameTick !== row.acceptedGameTick
                ) {
                    const value = Number(processingGameTick);
                    if (!Number.isSafeInteger(value)) {
                        await transaction.inputEvent.update({
                            where: { sequence: row.sequence },
                            data: {
                                status: 'FAILED',
                                error: 'Converted processing game tick is outside the safe integer range.',
                                completedAt: new Date(),
                                lockedBy: null,
                                leaseUntil: null,
                            },
                        });
                        continue;
                    }
                    Reflect.set(command, 'processingGameTick', value);
                }
                commands.push(command);
            }
            return commands;
        });
    }

    private async complete(requestId: string, result: unknown): Promise<void> {
        const completed = await this.db.inputEvent.updateMany({
            where: {
                requestId,
                target: 'ENGINE',
                status: 'PROCESSING',
                lockedBy: this.workerId,
            },
            data: {
                status: 'SUCCEEDED',
                result: asJson(result),
                completedAt: new Date(),
                error: null,
                lockedBy: null,
                leaseUntil: null,
            },
        });
        if (completed.count > 0) {
            return;
        }
        // Database hooks commit mutation results atomically with game state and
        // may already have set SUCCEEDED. Only the worker that still owns the
        // lease may clear that committed row's claim metadata.
        await this.db.inputEvent.updateMany({
            where: {
                requestId,
                target: 'ENGINE',
                status: 'SUCCEEDED',
                lockedBy: this.workerId,
            },
            data: {
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
