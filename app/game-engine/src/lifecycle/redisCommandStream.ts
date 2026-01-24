import type {
    TurnDaemonCommand,
    TurnDaemonCommandResponder,
    TurnDaemonControlQueue,
    TurnDaemonStatus,
    TurnDaemonCommandResult,
} from './types.js';
import { normalizeTurnDaemonCommand } from '../turn/commandRegistry.js';

export interface TurnDaemonStreamKeys {
    commandStream: string;
    eventStream: string;
}

export const buildTurnDaemonStreamKeys = (profileName: string): TurnDaemonStreamKeys => ({
    commandStream: `sammo:${profileName}:turn-daemon:commands`,
    eventStream: `sammo:${profileName}:turn-daemon:events`,
});

interface RedisStreamClient {
    xAdd(stream: string, id: string, message: Record<string, string>): Promise<string>;
    xRead(streams: { key: string; id: string }, options?: { BLOCK?: number; COUNT?: number }): Promise<unknown>;
}

type RedisStreamReadResponse = Array<{
    name: string;
    messages: Array<{ id: string; message: Record<string, string> }>;
}>;

type TurnDaemonEvent =
    | { type: 'status'; requestId?: string; status: TurnDaemonStatus }
    | { type: 'commandResult'; result: TurnDaemonCommandResult };

type TurnDaemonCommandEnvelope = {
    requestId: string;
    sentAt: string;
    command: TurnDaemonCommand;
};

type TurnDaemonEventEnvelope = {
    requestId?: string;
    sentAt: string;
    event: TurnDaemonEvent;
};

const parseCommandEnvelope = (raw: string): TurnDaemonCommandEnvelope | null => {
    try {
        const parsed = JSON.parse(raw) as Partial<TurnDaemonCommandEnvelope>;
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        if (!parsed.command || typeof parsed.command !== 'object') {
            return null;
        }
        if (typeof parsed.requestId !== 'string') {
            return null;
        }
        if (typeof parsed.sentAt !== 'string') {
            return null;
        }
        return parsed as TurnDaemonCommandEnvelope;
    } catch {
        return null;
    }
};

export class RedisTurnDaemonCommandStream implements TurnDaemonControlQueue, TurnDaemonCommandResponder {
    private readonly client: RedisStreamClient;
    private readonly keys: TurnDaemonStreamKeys;
    private readonly localQueue: TurnDaemonCommand[] = [];
    private lastId: string;

    constructor(
        client: RedisStreamClient,
        options: {
            keys: TurnDaemonStreamKeys;
            startId?: string;
        }
    ) {
        this.client = client;
        this.keys = options.keys;
        this.lastId = options.startId ?? '$';
    }

    enqueue(command: TurnDaemonCommand): void {
        this.localQueue.push(command);
    }

    async drain(): Promise<TurnDaemonCommand[]> {
        const drained = this.localQueue.splice(0, this.localQueue.length);
        const remote = await this.readRemoteCommands(1);
        return drained.concat(remote);
    }

    async waitUntil(deadlineMs: number | null): Promise<TurnDaemonCommand | null> {
        if (this.localQueue.length > 0) {
            return this.localQueue.shift() ?? null;
        }

        const blockMs = deadlineMs === null ? 0 : Math.max(0, deadlineMs - Date.now());
        const cappedBlockMs = deadlineMs === null ? 0 : Math.min(blockMs, 1000);
        if (deadlineMs !== null && blockMs === 0) {
            return null;
        }

        const remote = await this.readRemoteCommands(cappedBlockMs);
        if (remote.length === 0) {
            return null;
        }
        const [first, ...rest] = remote;
        if (rest.length > 0) {
            this.localQueue.push(...rest);
        }
        return first ?? null;
    }

    getDepth(): number {
        return this.localQueue.length;
    }

    async publishStatus(requestId: string, status: TurnDaemonStatus): Promise<void> {
        await this.publishEvent({ type: 'status', requestId, status }, requestId);
    }

    async publishCommandResult(requestId: string, result: TurnDaemonCommandResult): Promise<void> {
        await this.publishEvent({ type: 'commandResult', result }, requestId);
    }

    private async publishEvent(event: TurnDaemonEvent, requestId?: string): Promise<void> {
        const envelope: TurnDaemonEventEnvelope = {
            requestId,
            sentAt: new Date().toISOString(),
            event,
        };
        await this.client.xAdd(this.keys.eventStream, '*', {
            payload: JSON.stringify(envelope),
        });
    }

    private async readRemoteCommands(blockMs: number): Promise<TurnDaemonCommand[]> {
        const response = (await this.client.xRead(
            { key: this.keys.commandStream, id: this.lastId },
            { BLOCK: blockMs, COUNT: 100 }
        )) as RedisStreamReadResponse | null;

        if (!response) {
            return [];
        }

        const commands: TurnDaemonCommand[] = [];
        for (const stream of response) {
            for (const message of stream.messages) {
                this.lastId = message.id;
                const payload = message.message.payload;
                if (!payload) {
                    continue;
                }
                const envelope = parseCommandEnvelope(payload);
                if (!envelope) {
                    continue;
                }
                const command = normalizeTurnDaemonCommand(envelope);
                if (!command) {
                    continue;
                }
                commands.push(command);
            }
        }
        return commands;
    }
}
