import { randomUUID } from 'node:crypto';
import { parseTournamentSourceRevision, writeTournamentProjection } from '@sammo-ts/common';

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

const safeJsonParse = <T>(raw: string | null): T | null => {
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
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
        return safeJsonParse<TournamentState>(await this.redis.get(this.keys.stateKey));
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
        return safeJsonParse<TournamentParticipantEntry[]>(await this.redis.get(this.keys.participantsKey)) ?? [];
    }

    async setParticipants(participants: TournamentParticipantEntry[]): Promise<string> {
        return this.writeWithSourceRevision(this.keys.participantsKey, participants);
    }

    async getMatches(): Promise<TournamentMatchEntry[]> {
        return safeJsonParse<TournamentMatchEntry[]>(await this.redis.get(this.keys.matchesKey)) ?? [];
    }

    async setMatches(matches: TournamentMatchEntry[]): Promise<string> {
        return this.writeWithSourceRevision(this.keys.matchesKey, matches);
    }

    async getBettingEntries(): Promise<TournamentBetEntry[]> {
        return safeJsonParse<TournamentBetEntry[]>(await this.redis.get(this.keys.bettingKey)) ?? [];
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
