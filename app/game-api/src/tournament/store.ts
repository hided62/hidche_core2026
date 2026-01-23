import type { TournamentKeys } from './keys.js';
import type { TournamentBetEntry, TournamentMatchEntry, TournamentParticipantEntry, TournamentState } from './types.js';

interface RedisClientLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
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
    constructor(private readonly redis: RedisClientLike, private readonly keys: TournamentKeys) {}

    async getState(): Promise<TournamentState | null> {
        return safeJsonParse<TournamentState>(await this.redis.get(this.keys.stateKey));
    }

    async setState(state: TournamentState): Promise<void> {
        await this.redis.set(this.keys.stateKey, JSON.stringify(state));
    }

    async getParticipants(): Promise<TournamentParticipantEntry[]> {
        return safeJsonParse<TournamentParticipantEntry[]>(await this.redis.get(this.keys.participantsKey)) ?? [];
    }

    async setParticipants(participants: TournamentParticipantEntry[]): Promise<void> {
        await this.redis.set(this.keys.participantsKey, JSON.stringify(participants));
    }

    async getMatches(): Promise<TournamentMatchEntry[]> {
        return safeJsonParse<TournamentMatchEntry[]>(await this.redis.get(this.keys.matchesKey)) ?? [];
    }

    async setMatches(matches: TournamentMatchEntry[]): Promise<void> {
        await this.redis.set(this.keys.matchesKey, JSON.stringify(matches));
    }

    async getBettingEntries(): Promise<TournamentBetEntry[]> {
        return safeJsonParse<TournamentBetEntry[]>(await this.redis.get(this.keys.bettingKey)) ?? [];
    }

    async setBettingEntries(entries: TournamentBetEntry[]): Promise<void> {
        await this.redis.set(this.keys.bettingKey, JSON.stringify(entries));
    }
}
