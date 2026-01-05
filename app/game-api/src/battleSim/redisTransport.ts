import crypto from 'node:crypto';

import type { BattleSimJobPayload, BattleSimResultPayload, BattleSimTransportResponse } from './types.js';
import type { BattleSimQueueKeys } from './keys.js';

type RedisBlPopResult = { key: string; element: string } | [string, string] | null;

interface RedisClientLike {
    rPush(key: string, value: string): Promise<number>;
    blPop(key: string, timeout: number): Promise<RedisBlPopResult>;
    set(key: string, value: string, options?: { EX?: number }): Promise<string | null>;
    get(key: string): Promise<string | null>;
    expire(key: string, seconds: number): Promise<number>;
}

export interface RedisBattleSimTransportOptions {
    keys: BattleSimQueueKeys;
    requestTimeoutMs: number;
    resultTtlSeconds: number;
}

const toTimeoutSeconds = (timeoutMs: number): number => Math.max(1, Math.ceil(timeoutMs / 1000));

const parseBlPopValue = (result: RedisBlPopResult): string | null => {
    if (!result) {
        return null;
    }
    if (Array.isArray(result)) {
        return result[1] ?? null;
    }
    return result.element ?? null;
};

export class RedisBattleSimTransport {
    private readonly client: RedisClientLike;
    private readonly keys: BattleSimQueueKeys;
    private readonly requestTimeoutMs: number;
    private readonly resultTtlSeconds: number;

    constructor(client: RedisClientLike, options: RedisBattleSimTransportOptions) {
        this.client = client;
        this.keys = options.keys;
        this.requestTimeoutMs = options.requestTimeoutMs;
        this.resultTtlSeconds = options.resultTtlSeconds;
    }

    private buildResultKey(jobId: string): string {
        return `${this.keys.resultKeyPrefix}${jobId}`;
    }

    private buildNotifyKey(jobId: string): string {
        return `${this.keys.notifyKeyPrefix}${jobId}`;
    }

    private async readResult(jobId: string): Promise<BattleSimResultPayload | null> {
        const raw = await this.client.get(this.buildResultKey(jobId));
        if (!raw) {
            return null;
        }
        try {
            return JSON.parse(raw) as BattleSimResultPayload;
        } catch {
            return null;
        }
    }

    private async waitForResult(jobId: string, timeoutMs: number): Promise<BattleSimResultPayload | null> {
        const existing = await this.readResult(jobId);
        if (existing) {
            return existing;
        }

        const notifyKey = this.buildNotifyKey(jobId);
        const timeoutSec = toTimeoutSeconds(timeoutMs);
        const signal = await this.client.blPop(notifyKey, timeoutSec);
        if (!parseBlPopValue(signal)) {
            return null;
        }
        return this.readResult(jobId);
    }

    public async simulate(payload: BattleSimJobPayload): Promise<BattleSimTransportResponse> {
        const jobId = crypto.randomUUID();
        const job = {
            jobId,
            requestedAt: new Date().toISOString(),
            payload,
        };
        await this.client.rPush(this.keys.queueKey, JSON.stringify(job));

        const result = await this.waitForResult(jobId, this.requestTimeoutMs);
        if (result) {
            return { status: 'completed', jobId, payload: result };
        }
        return { status: 'queued', jobId };
    }

    public async getSimulationResult(jobId: string): Promise<BattleSimResultPayload | null> {
        return this.readResult(jobId);
    }

    public async pushResult(jobId: string, payload: BattleSimResultPayload): Promise<void> {
        const resultKey = this.buildResultKey(jobId);
        const notifyKey = this.buildNotifyKey(jobId);
        await this.client.set(resultKey, JSON.stringify(payload), {
            EX: this.resultTtlSeconds,
        });
        await this.client.rPush(notifyKey, 'ready');
        await this.client.expire(notifyKey, this.resultTtlSeconds);
    }
}
