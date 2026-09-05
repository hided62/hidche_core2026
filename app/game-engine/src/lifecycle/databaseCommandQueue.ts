import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { GamePrisma, readInputEventClockCoordinate, type GamePrismaClient } from '@sammo-ts/infra';

import { normalizeTurnDaemonCommand } from '../turn/commandRegistry.js';
import type {
    TurnDaemonCommand,
    TurnDaemonCommandResponder,
    TurnDaemonCommandResult,
    TurnDaemonControlQueue,
    TurnDaemonStatus,
} from './types.js';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const serializeResult = (value: unknown): string =>
    JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item)) ?? 'null';

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
        // 종료 직후 실행하지 않을 명령을 PROCESSING으로 선점하면 새 daemon은
        // lease 만료까지 기다려야 한다. 종료 batch에서는 DB 명령을 가져오지 않는다.
        if (local.some((command) => command.type === 'shutdown')) {
            return local;
        }
        const remote = await this.claimPending();
        return local.concat(remote);
    }

    async waitFor(timeoutMs: number | null): Promise<TurnDaemonCommand | null> {
        const deadline = timeoutMs === null ? null : performance.now() + Math.max(0, timeoutMs);
        while (deadline === null || performance.now() < deadline) {
            const local = this.localQueue.shift();
            if (local) {
                return local;
            }
            const remote = await this.claimPending(1);
            if (remote[0]) {
                return remote[0];
            }
            const remaining = deadline === null ? 100 : Math.max(1, Math.min(100, deadline - performance.now()));
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
            await transaction.$executeRaw(GamePrisma.sql`
                UPDATE input_event
                SET status = ${terminal ? 'FAILED' : 'PENDING'}::"InputEventStatus",
                    processing_at = NULL,
                    locked_by = NULL,
                    lease_until = NULL,
                    completed_at = CASE
                        WHEN ${terminal} THEN CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                        ELSE NULL
                    END,
                    result = NULL,
                    error = ${message}
                WHERE request_id = ${requestId}
                  AND target = 'ENGINE'::"InputEventTarget"
                  AND status = 'PROCESSING'::"InputEventStatus"
                  AND locked_by = ${this.workerId}
                  AND attempts = ${event.attempts}
            `);
        });
    }

    private async claimPending(limit = 100): Promise<TurnDaemonCommand[]> {
        await this.recoverExpiredLeases();
        return this.db.$transaction(async (transaction) => {
            const claimCoordinate = await readInputEventClockCoordinate(transaction);
            const world = await transaction.worldState.findFirst({
                orderBy: { id: 'asc' },
                select: { clockPhase: true, clockRevision: true, deadlineGeneration: true, clockTick: true },
            });
            // 가오픈도 장수 생성·삭제·거병·예약 등 사용자 명령은 처리한다.
            // 자동 턴의 RUNNING/MANUAL gate는 TurnDaemonLifecycle이 별도로 지킨다.
            const gameplayAllowed =
                !world ||
                world.clockPhase === 'PREOPEN' ||
                world.clockPhase === 'RUNNING' ||
                world.clockPhase === 'MANUAL';
            const suspendedTournamentBetCommand = world?.clockPhase === 'SUSPENDED';
            const currentRevision = world?.clockRevision ?? null;
            const maintenanceSuspended =
                world?.clockPhase === 'SUSPENDED' &&
                Boolean(
                    await transaction.clockSuspension.findFirst({
                        where: {
                            status: 'SUSPENDED',
                            source: 'MAINTENANCE',
                            sourceRevision: world.clockRevision,
                        },
                        select: { id: true },
                    })
                );
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
                          ${suspendedTournamentBetCommand}
                          AND "event_type" IN ('adjustGeneralResources', 'adjustGeneralMeta')
                          AND "payload" ->> 'reason' IN ('tournamentBet', 'tournamentBetRollback')
                      )
                      OR (
                          ${maintenanceSuspended}
                          AND "event_type" IN (
                              'inheritanceAction',
                              'dropItem',
                              'changePermission',
                              'appoint',
                              'setNationSetting',
                              'setNpcPolicy',
                              'shiftSchedule'
                          )
                      )
                      OR (
                          ${maintenanceSuspended}
                          AND "event_type" = 'messageRespond'
                          AND "payload" ->> 'messageId' ~ '^[1-9][0-9]*$'
                          AND EXISTS (
                              SELECT 1
                              FROM "message_action" AS pending_action
                              WHERE pending_action."message_id" = ("input_event"."payload" ->> 'messageId')::integer
                                AND pending_action."status" = 'PENDING'
                                AND pending_action."clock_revision" = ${currentRevision}
                                AND pending_action."deadline_generation" = ${world?.deadlineGeneration ?? null}
                          )
                      )
                      OR (
                          ${world?.clockPhase === 'SUSPENDED'}
                          AND "event_type" = 'messageRespond'
                          AND "payload" ->> 'messageId' ~ '^[1-9][0-9]*$'
                          AND EXISTS (
                              SELECT 1
                              FROM "message" AS pending_message
                              JOIN "message_action" AS pending_action
                                ON pending_action."message_id" = pending_message."id"
                              WHERE pending_message."id" = ("input_event"."payload" ->> 'messageId')::integer
                                AND pending_message."message" #>> '{option,action}' = 'raiseInvader'
                                AND pending_action."action_type" = 'raiseInvader'
                                AND pending_action."status" = 'PENDING'
                                AND pending_action."clock_revision" = ${currentRevision}
                                AND pending_action."deadline_generation" = ${world?.deadlineGeneration ?? null}
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
                if (row.eventType === 'getStatus') return row.acceptedGameTick ?? claimCoordinate.gameTick;
                if (row.acceptedGameTick === null || row.acceptedClockRevision === null || currentRevision === null) {
                    return claimCoordinate.gameTick;
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
                await transaction.$executeRaw(GamePrisma.sql`
                    UPDATE input_event
                    SET status = 'PROCESSING'::"InputEventStatus",
                        processing_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
                        accepted_game_tick = COALESCE(accepted_game_tick, ${processingGameTick}),
                        accepted_clock_revision = COALESCE(accepted_clock_revision, ${currentRevision}),
                        accepted_deadline_generation = COALESCE(
                            accepted_deadline_generation,
                            ${world?.deadlineGeneration ?? null}
                        ),
                        processing_game_tick = ${processingGameTick},
                        processing_clock_revision = ${currentRevision},
                        processing_deadline_generation = ${world?.deadlineGeneration ?? null},
                        locked_by = ${this.workerId},
                        lease_until = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                            + ${this.leaseDurationMs} * INTERVAL '1 millisecond',
                        attempts = attempts + 1
                    WHERE sequence = ${row.sequence}
                `);
            }

            const commands: TurnDaemonCommand[] = [];
            for (const { row, processingGameTick } of processableRows) {
                const command = normalizeTurnDaemonCommand({
                    requestId: row.requestId,
                    sentAt: row.createdAt.toISOString(),
                    command: row.payload as TurnDaemonCommand,
                });
                if (!command) {
                    await transaction.$executeRaw(GamePrisma.sql`
                        UPDATE input_event
                        SET status = 'FAILED'::"InputEventStatus",
                            error = ${`Invalid command payload for ${row.eventType}`},
                            completed_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
                            locked_by = NULL,
                            lease_until = NULL
                        WHERE sequence = ${row.sequence}
                    `);
                    continue;
                }
                if (processingGameTick !== null) {
                    const value = Number(processingGameTick);
                    if (!Number.isSafeInteger(value)) {
                        await transaction.$executeRaw(GamePrisma.sql`
                            UPDATE input_event
                            SET status = 'FAILED'::"InputEventStatus",
                                error = 'Converted processing game tick is outside the safe integer range.',
                                completed_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
                                locked_by = NULL,
                                lease_until = NULL
                            WHERE sequence = ${row.sequence}
                        `);
                        continue;
                    }
                    Reflect.set(command, 'processingGameTick', value);
                }
                Reflect.set(command, 'requestedAtWall', row.createdAt);
                commands.push(command);
            }
            return commands;
        });
    }

    private async complete(requestId: string, result: unknown): Promise<void> {
        const completed = await this.db.$executeRaw(GamePrisma.sql`
            UPDATE input_event
            SET status = 'SUCCEEDED'::"InputEventStatus",
                result = CAST(${serializeResult(result)} AS jsonb),
                completed_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
                error = NULL,
                locked_by = NULL,
                lease_until = NULL
            WHERE request_id = ${requestId}
              AND target = 'ENGINE'::"InputEventTarget"
              AND status = 'PROCESSING'::"InputEventStatus"
              AND locked_by = ${this.workerId}
        `);
        if (completed > 0) {
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
        await this.db.$executeRaw(GamePrisma.sql`
            UPDATE input_event
            SET status = 'PENDING'::"InputEventStatus",
                processing_at = NULL,
                locked_by = NULL,
                lease_until = NULL
            WHERE target = 'ENGINE'::"InputEventTarget"
              AND status = 'PROCESSING'::"InputEventStatus"
              AND lease_until < CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
        `);
    }
}
