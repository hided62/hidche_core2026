import { randomUUID } from 'node:crypto';

import type { TurnDaemonStreamKeys } from './streamKeys.js';
import type { TurnDaemonTransport } from './transport.js';
import type {
    TurnDaemonCommand,
    TurnDaemonCommandEnvelope,
    TurnDaemonCommandResult,
    TurnDaemonEventEnvelope,
    TurnDaemonStatus,
} from './types.js';

interface RedisTurnDaemonTransportOptions {
    keys: TurnDaemonStreamKeys;
    requestTimeoutMs: number;
}

interface RedisClientLike {
    xAdd(stream: string, id: string, message: Record<string, string>): Promise<string>;
    xRead(streams: { key: string; id: string }, options?: { BLOCK?: number; COUNT?: number }): Promise<unknown>;
}

type RedisStreamReadResponse = Array<{
    name: string;
    messages: Array<{ id: string; message: Record<string, string> }>;
}>;

const buildCommandEnvelope = (command: TurnDaemonCommand): TurnDaemonCommandEnvelope => {
    const requestId = command.type === 'getStatus' && command.requestId ? command.requestId : randomUUID();
    return {
        requestId,
        sentAt: new Date().toISOString(),
        command,
    };
};

const parseEventEnvelope = (raw: string): TurnDaemonEventEnvelope | null => {
    try {
        const parsed = JSON.parse(raw) as Partial<TurnDaemonEventEnvelope>;
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        if (!parsed.event || typeof parsed.event !== 'object') {
            return null;
        }
        if (typeof parsed.sentAt !== 'string') {
            return null;
        }
        return parsed as TurnDaemonEventEnvelope;
    } catch {
        return null;
    }
};

// 턴 데몬 제어 스트림을 Redis로 구현한 전송기.
export class RedisTurnDaemonTransport implements TurnDaemonTransport {
    private readonly client: RedisClientLike;
    private readonly keys: TurnDaemonStreamKeys;
    private readonly requestTimeoutMs: number;

    constructor(client: RedisClientLike, options: RedisTurnDaemonTransportOptions) {
        this.client = client;
        this.keys = options.keys;
        this.requestTimeoutMs = options.requestTimeoutMs;
    }

    // Redis 스트림에 명령을 기록해서 턴 데몬에게 전달한다.
    async sendCommand(command: TurnDaemonCommand): Promise<string> {
        const envelope = buildCommandEnvelope(command);
        await this.client.xAdd(this.keys.commandStream, '*', {
            payload: JSON.stringify(envelope),
        });
        return envelope.requestId;
    }

    async requestCommand(command: TurnDaemonCommand, timeoutMs?: number): Promise<TurnDaemonCommandResult | null> {
        const requestId = await this.sendCommand(command);

        const deadline = Date.now() + (timeoutMs ?? this.requestTimeoutMs);
        let lastId = '$';

        while (Date.now() < deadline) {
            const remaining = Math.max(1, deadline - Date.now());
            const response = (await this.client.xRead(
                { key: this.keys.eventStream, id: lastId },
                { BLOCK: remaining, COUNT: 10 }
            )) as RedisStreamReadResponse | null;

            if (!response) {
                return null;
            }

            for (const stream of response) {
                for (const message of stream.messages) {
                    lastId = message.id;
                    const payload = message.message.payload;
                    if (!payload) {
                        continue;
                    }
                    const envelope = parseEventEnvelope(payload);
                    if (!envelope) {
                        continue;
                    }
                    if (envelope.event.type === 'commandResult' && envelope.requestId === requestId) {
                        return envelope.event.result;
                    }
                }
            }
        }

        return null;
    }

    async requestStatus(timeoutMs?: number): Promise<TurnDaemonStatus | null> {
        const requestId = randomUUID();
        await this.sendCommand({ type: 'getStatus', requestId });

        const deadline = Date.now() + (timeoutMs ?? this.requestTimeoutMs);
        let lastId = '$';

        while (Date.now() < deadline) {
            const remaining = Math.max(1, deadline - Date.now());
            const response = (await this.client.xRead(
                { key: this.keys.eventStream, id: lastId },
                { BLOCK: remaining, COUNT: 10 }
            )) as RedisStreamReadResponse | null;

            if (!response) {
                return null;
            }

            for (const stream of response) {
                for (const message of stream.messages) {
                    lastId = message.id;
                    const payload = message.message.payload;
                    if (!payload) {
                        continue;
                    }
                    const envelope = parseEventEnvelope(payload);
                    if (!envelope) {
                        continue;
                    }
                    if (envelope.event.type === 'status' && envelope.requestId === requestId) {
                        return envelope.event.status;
                    }
                }
            }
        }

        return null;
    }
}
