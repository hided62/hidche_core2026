import { randomUUID } from 'node:crypto';

import {
    acquireGameSchemaAdvisoryXactLock,
    readInputEventClockCoordinate,
    type DatabaseClient,
    type GamePrisma,
    type InputEventClockCoordinate,
} from '@sammo-ts/infra';

import type { TurnDaemonTransport } from './transport.js';
import type { TurnDaemonCommand, TurnDaemonCommandResult, TurnDaemonStatus } from './types.js';
import { loadCurrentGameTime } from '../services/gameClock.js';

const asJson = (value: unknown): GamePrisma.InputJsonValue => value as GamePrisma.InputJsonValue;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const stableJson = (value: unknown): string => {
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
};
export const commandIdentityJson = (value: unknown): string => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return stableJson(value);
    }
    const commandType = String(Reflect.get(value, 'type'));
    if (
        [
            'npcPossessGeneral',
            'selectPoolReserve',
            'selectPoolCreate',
            'selectPoolReselect',
            'voteReward',
            'auctionBid',
        ].includes(commandType)
    ) {
        const {
            acceptedGameAt: _acceptedGameAt,
            acceptedGameTick: _acceptedGameTick,
            ...identity
        } = value as Record<string, unknown>;
        return stableJson(identity);
    }
    return stableJson(value);
};

export class ConflictingTurnDaemonCommandError extends Error {
    constructor(readonly requestId: string) {
        super(`Engine input event ${requestId} already exists with a different payload.`);
        this.name = 'ConflictingTurnDaemonCommandError';
    }
}

export class FailedTurnDaemonCommandError extends Error {
    constructor(
        readonly requestId: string,
        readonly storedError: string | null
    ) {
        super(storedError ?? `Engine input event ${requestId} failed.`);
        this.name = 'FailedTurnDaemonCommandError';
    }
}

export class RejectedNpcPossessionCommandError extends Error {
    constructor(
        readonly code: 'PRECONDITION_FAILED',
        message: string
    ) {
        super(message);
        this.name = 'RejectedNpcPossessionCommandError';
    }
}

export class DatabaseTurnDaemonTransport implements TurnDaemonTransport {
    constructor(
        private readonly db: DatabaseClient,
        private readonly requestTimeoutMs: number
    ) {}

    async sendCommand(command: TurnDaemonCommand): Promise<string> {
        const requestId = ('requestId' in command ? command.requestId : undefined) ?? randomUUID();
        const durableCommand = JSON.parse(JSON.stringify({ ...command, requestId })) as TurnDaemonCommand;
        if (durableCommand.type === 'npcPossessGeneral') {
            delete durableCommand.acceptedGameAt;
        }
        if (command.type === 'npcPossessGeneral') {
            const existing = await this.db.inputEvent.findUnique({
                where: { requestId },
                select: { eventType: true, payload: true },
            });
            if (existing) {
                if (
                    existing.eventType !== command.type ||
                    commandIdentityJson(existing.payload) !== commandIdentityJson(durableCommand)
                ) {
                    throw new ConflictingTurnDaemonCommandError(requestId);
                }
                return requestId;
            }
        }
        try {
            if (command.type === 'npcPossessGeneral' && this.db.$transaction) {
                const rejectionReason = await this.db.$transaction(async (transaction) => {
                    const coordinate = await readInputEventClockCoordinate(transaction);
                    await acquireGameSchemaAdvisoryXactLock(transaction, 'npc-possession:global');
                    await acquireGameSchemaAdvisoryXactLock(transaction, `npc-possession:user:${command.userId}`);
                    const acceptedGameAt = coordinate.gameAt;
                    const token = await transaction.npcSelectionToken.findFirst({
                        where: {
                            ownerUserId: command.userId,
                            nonce: command.tokenNonce,
                            validUntil: { gte: acceptedGameAt },
                        },
                        select: { pickResult: true },
                    });
                    if (!token) {
                        return '유효한 장수 목록이 없습니다.';
                    }
                    if (
                        !token.pickResult ||
                        typeof token.pickResult !== 'object' ||
                        Array.isArray(token.pickResult) ||
                        !Object.hasOwn(token.pickResult, String(command.generalId))
                    ) {
                        return '선택한 장수가 목록에 없습니다.';
                    }
                    const acceptedCommand: Extract<TurnDaemonCommand, { type: 'npcPossessGeneral' }> = {
                        ...(durableCommand as Extract<TurnDaemonCommand, { type: 'npcPossessGeneral' }>),
                        acceptedGameAt: acceptedGameAt.toISOString(),
                    };
                    await this.createInputEvent(transaction, acceptedCommand, requestId, coordinate);
                    return null;
                });
                if (rejectionReason) {
                    throw new RejectedNpcPossessionCommandError('PRECONDITION_FAILED', rejectionReason);
                }
            } else {
                if (this.db.$transaction) {
                    await this.db.$transaction(async (transaction) => {
                        const coordinate = await readInputEventClockCoordinate(transaction);
                        await this.createInputEvent(transaction, durableCommand, requestId, coordinate);
                    });
                } else {
                    await this.createInputEvent(this.db, durableCommand, requestId);
                }
            }
        } catch (error) {
            if (error instanceof RejectedNpcPossessionCommandError) {
                throw error;
            }
            const isUniqueConflict =
                typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
            if (!isUniqueConflict) {
                throw error;
            }
            const existing = await this.db.inputEvent.findUniqueOrThrow({
                where: { requestId },
                select: { eventType: true, payload: true },
            });
            if (
                existing.eventType !== command.type ||
                commandIdentityJson(existing.payload) !== commandIdentityJson(durableCommand)
            ) {
                throw new ConflictingTurnDaemonCommandError(requestId);
            }
        }
        return requestId;
    }

    private async createInputEvent(
        db: DatabaseClient,
        command: TurnDaemonCommand,
        requestId: string,
        coordinate?: InputEventClockCoordinate
    ): Promise<void> {
        const gameTime = coordinate ? null : await loadCurrentGameTime(db, new Date());
        const commandAcceptedTick = Reflect.get(command, 'acceptedGameTick');
        const acceptedGameTick =
            typeof commandAcceptedTick === 'number' && Number.isSafeInteger(commandAcceptedTick)
                ? commandAcceptedTick
                : coordinate
                  ? Number(coordinate.gameTick)
                  : gameTime!.tick;
        const acceptedClockRevision = coordinate ? Number(coordinate.clockRevision) : gameTime!.revision;
        const acceptedDeadlineGeneration = coordinate
            ? Number(coordinate.deadlineGeneration)
            : gameTime!.deadlineGeneration;
        await db.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: command.type,
                payload: asJson(command),
                actorUserId: 'userId' in command && typeof command.userId === 'string' ? command.userId : null,
                ...(acceptedGameTick === null ? {} : { acceptedGameTick: BigInt(acceptedGameTick) }),
                ...(acceptedClockRevision === null || acceptedClockRevision === undefined
                    ? {}
                    : { acceptedClockRevision: BigInt(acceptedClockRevision) }),
                ...(acceptedDeadlineGeneration === null || acceptedDeadlineGeneration === undefined
                    ? {}
                    : { acceptedDeadlineGeneration: BigInt(acceptedDeadlineGeneration) }),
                ...(coordinate ? { createdAt: coordinate.wallAt } : {}),
            },
        });
    }

    async requestCommand(command: TurnDaemonCommand, timeoutMs?: number): Promise<TurnDaemonCommandResult | null> {
        const requestId = await this.sendCommand(command);
        return this.waitForResult<TurnDaemonCommandResult>(requestId, timeoutMs);
    }

    async requestStatus(timeoutMs?: number): Promise<TurnDaemonStatus | null> {
        const requestId = await this.sendCommand({ type: 'getStatus', requestId: randomUUID() });
        const payload = await this.waitForResult<{ status: TurnDaemonStatus }>(requestId, timeoutMs);
        return payload?.status ?? null;
    }

    private async waitForResult<T>(requestId: string, timeoutMs?: number): Promise<T | null> {
        const deadline = Date.now() + (timeoutMs ?? this.requestTimeoutMs);
        while (Date.now() < deadline) {
            const event = await this.db.inputEvent.findUnique({
                where: { requestId },
                select: { status: true, result: true, error: true },
            });
            if (event?.status === 'SUCCEEDED') {
                return event.result as T;
            }
            if (event?.status === 'FAILED') {
                throw new FailedTurnDaemonCommandError(requestId, event.error);
            }
            await delay(Math.min(50, Math.max(1, deadline - Date.now())));
        }
        return null;
    }
}
