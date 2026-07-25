import { randomUUID } from 'node:crypto';

import type { GamePrisma } from '@sammo-ts/infra';

import type { DatabaseClient } from '../context.js';
import type { TurnDaemonTransport } from './transport.js';
import type { TurnDaemonCommand, TurnDaemonCommandResult, TurnDaemonStatus } from './types.js';

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

export class ConflictingTurnDaemonCommandError extends Error {
    constructor(readonly requestId: string) {
        super(`Engine input event ${requestId} already exists with a different payload.`);
        this.name = 'ConflictingTurnDaemonCommandError';
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
        try {
            await this.db.inputEvent.create({
                data: {
                    requestId,
                    target: 'ENGINE',
                    eventType: command.type,
                    payload: asJson(durableCommand),
                },
            });
        } catch (error) {
            const isUniqueConflict =
                typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
            if (!isUniqueConflict) {
                throw error;
            }
            const existing = await this.db.inputEvent.findUniqueOrThrow({
                where: { requestId },
                select: { eventType: true, payload: true },
            });
            if (existing.eventType !== command.type || stableJson(existing.payload) !== stableJson(durableCommand)) {
                throw new ConflictingTurnDaemonCommandError(requestId);
            }
        }
        return requestId;
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
                select: { status: true, result: true },
            });
            if (event?.status === 'SUCCEEDED') {
                return event.result as T;
            }
            if (event?.status === 'FAILED') {
                return null;
            }
            await delay(Math.min(50, Math.max(1, deadline - Date.now())));
        }
        return null;
    }
}
