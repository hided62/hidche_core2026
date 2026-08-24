import { randomUUID } from 'node:crypto';
import { parseTournamentSourceRevision, writeTournamentProjection } from '@sammo-ts/common';
import { z } from 'zod';

import type { TournamentKeys } from './keys.js';
import type { TournamentBetEntry, TournamentMatchEntry, TournamentParticipantEntry, TournamentState } from './types.js';

interface RedisClientLike {
    get(key: string): Promise<string | null>;
    set(
        key: string,
        value: string,
        options?: {
            NX?: boolean;
            PX?: number;
        }
    ): Promise<unknown>;
    del?(key: string): Promise<unknown>;
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
    publish?(channel: string, message: string): Promise<unknown>;
}

export class CorruptTournamentProjectionError extends Error {
    constructor(readonly key: string) {
        super(`Tournament projection is malformed: ${key}`);
        this.name = 'CorruptTournamentProjectionError';
    }
}

const zTournamentState = z
    .object({
        stage: z.number().int(),
        phase: z.number().int(),
        type: z.number().int(),
        auto: z.boolean(),
        openYear: z.number().int(),
        openMonth: z.number().int(),
        termSeconds: z.number(),
        nextAt: z.string(),
        bettingId: z.number().int().optional(),
        bettingCloseAt: z.string().optional(),
        winnerId: z.number().int().optional(),
        bettingSettled: z.boolean().optional(),
        rewardSettled: z.boolean().optional(),
        participantsLockedAt: z.string().optional(),
        lastError: z.string().optional(),
        lastErrorAt: z.string().optional(),
    })
    .passthrough();

const zTournamentParticipant = z
    .object({
        id: z.number().int(),
        name: z.string(),
        leadership: z.number(),
        strength: z.number(),
        intel: z.number(),
        level: z.number(),
        groupId: z.number().int().optional(),
        groupNo: z.number().int().optional(),
        win: z.number().int().optional(),
        draw: z.number().int().optional(),
        lose: z.number().int().optional(),
        gl: z.number().int().optional(),
        seedRank: z.number().int().optional(),
        finalRank: z.number().int().optional(),
        preliminaryGroupId: z.number().int().optional(),
        preliminaryGroupNo: z.number().int().optional(),
        preliminaryRank: z.number().int().optional(),
        preliminaryWin: z.number().int().optional(),
        preliminaryDraw: z.number().int().optional(),
        preliminaryLose: z.number().int().optional(),
        preliminaryGl: z.number().int().optional(),
    })
    .passthrough();

const zTournamentLogEntry = z
    .object({
        phase: z.number().int(),
        attackerEnergy: z.number(),
        defenderEnergy: z.number(),
        attackerDamage: z.number(),
        defenderDamage: z.number(),
        text: z.string(),
    })
    .passthrough();

const zTournamentMatch = z
    .object({
        id: z.number().int(),
        stage: z.number().int(),
        roundIndex: z.number().int(),
        attackerId: z.number().int(),
        defenderId: z.number().int(),
        groupId: z.number().int().optional(),
        winnerId: z.number().int().optional(),
        log: z.array(z.string()).optional(),
        logEntries: z.array(zTournamentLogEntry).optional(),
        lastEnergy: z
            .object({
                attacker: z.number(),
                defender: z.number(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

const zTournamentBet = z
    .object({
        generalId: z.number().int(),
        targetId: z.number().int(),
        amount: z.number(),
    })
    .passthrough();

const parseProjection = <T>(raw: string | null, key: string, schema: z.ZodType<T>): T | null => {
    if (raw === null) {
        return null;
    }
    let value: unknown;
    try {
        value = JSON.parse(raw) as unknown;
    } catch {
        throw new CorruptTournamentProjectionError(key);
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        throw new CorruptTournamentProjectionError(key);
    }
    return parsed.data;
};

export class TournamentStore {
    constructor(
        private readonly redis: RedisClientLike,
        private readonly keys: TournamentKeys
    ) {}

    async withMutationLock<T>(operation: () => Promise<T>, timeoutMs = 2_000): Promise<T> {
        if (!this.redis.del) {
            return operation();
        }

        const lockKey = `${this.keys.stateKey}:mutation-lock`;
        const token = randomUUID();
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const acquired = await this.redis.set(lockKey, token, { NX: true, PX: 30_000 });
            if (acquired) {
                try {
                    return await operation();
                } finally {
                    if ((await this.redis.get(lockKey)) === token) {
                        await this.redis.del(lockKey);
                    }
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error('토너먼트 요청이 처리 중입니다. 잠시 후 다시 시도해주세요.');
    }

    async getState(): Promise<TournamentState | null> {
        return parseProjection(
            await this.redis.get(this.keys.stateKey),
            this.keys.stateKey,
            zTournamentState
        ) as TournamentState | null;
    }

    async getSourceRevision(): Promise<string | null> {
        return parseTournamentSourceRevision(await this.redis.get(this.keys.sourceRevisionKey));
    }

    private async writeWithSourceRevision(key: string, value: unknown): Promise<string> {
        return writeTournamentProjection(this.redis, this.keys, [{ key, value }]);
    }

    async setState(state: TournamentState): Promise<string> {
        return this.writeWithSourceRevision(this.keys.stateKey, state);
    }

    async getParticipants(): Promise<TournamentParticipantEntry[]> {
        return (
            parseProjection(
                await this.redis.get(this.keys.participantsKey),
                this.keys.participantsKey,
                z.array(zTournamentParticipant)
            ) ?? []
        );
    }

    async setParticipants(participants: TournamentParticipantEntry[]): Promise<string> {
        return this.writeWithSourceRevision(this.keys.participantsKey, participants);
    }

    async getMatches(): Promise<TournamentMatchEntry[]> {
        return (
            parseProjection(
                await this.redis.get(this.keys.matchesKey),
                this.keys.matchesKey,
                z.array(zTournamentMatch)
            ) ?? []
        );
    }

    async setMatches(matches: TournamentMatchEntry[]): Promise<string> {
        return this.writeWithSourceRevision(this.keys.matchesKey, matches);
    }

    async getBettingEntries(): Promise<TournamentBetEntry[]> {
        return (
            parseProjection(
                await this.redis.get(this.keys.bettingKey),
                this.keys.bettingKey,
                z.array(zTournamentBet)
            ) ?? []
        );
    }

    async setBettingEntries(entries: TournamentBetEntry[]): Promise<string> {
        return this.writeWithSourceRevision(this.keys.bettingKey, entries);
    }

    async appendBettingEntry(entry: TournamentBetEntry): Promise<TournamentBetEntry[]> {
        const entries = await this.getBettingEntries();
        const existing = entries.find(
            (candidate) => candidate.generalId === entry.generalId && candidate.targetId === entry.targetId
        );
        if (existing) {
            existing.amount += entry.amount;
        } else {
            entries.push(entry);
        }
        await this.setBettingEntries(entries);
        return entries;
    }
}
