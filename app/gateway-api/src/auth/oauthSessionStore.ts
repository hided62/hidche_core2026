import { randomUUID } from 'node:crypto';

export type OAuthMode = 'login' | 'change_pw';

export interface OAuthPendingState {
    state: string;
    mode: OAuthMode;
    scopes: string[];
    createdAt: string;
}

export interface OAuthSession {
    id: string;
    mode: OAuthMode;
    kakaoId: string;
    email: string;
    accessToken: string;
    refreshToken?: string;
    accessTokenValidUntil: string;
    refreshTokenValidUntil?: string;
    createdAt: string;
}

export interface OAuthSessionStore {
    createPendingState(mode: OAuthMode, scopes: string[]): Promise<OAuthPendingState>;
    consumePendingState(state: string): Promise<OAuthPendingState | null>;
    createSession(session: Omit<OAuthSession, 'id'>): Promise<OAuthSession>;
    consumeSession(sessionId: string): Promise<OAuthSession | null>;
}

interface RedisPipeline {
    set(key: string, value: string, options?: { EX?: number }): RedisPipeline;
    del(key: string): RedisPipeline;
    exec(): Promise<unknown>;
}

interface RedisClientLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
    del(key: string): Promise<number>;
    multi(): RedisPipeline;
}

const parseJson = <T>(raw: string | null): T | null => {
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
};

export class RedisOAuthSessionStore implements OAuthSessionStore {
    private readonly client: RedisClientLike;
    private readonly prefix: string;
    private readonly ttlSeconds: number;

    constructor(client: RedisClientLike, prefix: string, ttlSeconds: number) {
        this.client = client;
        this.prefix = prefix;
        this.ttlSeconds = ttlSeconds;
    }

    private stateKey(state: string): string {
        return `${this.prefix}:oauth-state:${state}`;
    }

    private sessionKey(sessionId: string): string {
        return `${this.prefix}:oauth-session:${sessionId}`;
    }

    async createPendingState(mode: OAuthMode, scopes: string[]): Promise<OAuthPendingState> {
        const state: OAuthPendingState = {
            state: randomUUID(),
            mode,
            scopes,
            createdAt: new Date().toISOString(),
        };
        await this.client.set(this.stateKey(state.state), JSON.stringify(state), {
            EX: this.ttlSeconds,
        });
        return state;
    }

    async consumePendingState(state: string): Promise<OAuthPendingState | null> {
        const key = this.stateKey(state);
        const raw = await this.client.get(key);
        if (!raw) {
            return null;
        }
        await this.client.del(key);
        return parseJson<OAuthPendingState>(raw);
    }

    async createSession(session: Omit<OAuthSession, 'id'>): Promise<OAuthSession> {
        const stored: OAuthSession = {
            ...session,
            id: randomUUID(),
        };
        await this.client.set(this.sessionKey(stored.id), JSON.stringify(stored), {
            EX: this.ttlSeconds,
        });
        return stored;
    }

    async consumeSession(sessionId: string): Promise<OAuthSession | null> {
        const key = this.sessionKey(sessionId);
        const raw = await this.client.get(key);
        if (!raw) {
            return null;
        }
        await this.client.del(key);
        return parseJson<OAuthSession>(raw);
    }
}

// 테스트용 인메모리 OAuth 세션 저장소.
export class InMemoryOAuthSessionStore implements OAuthSessionStore {
    private readonly pendingStates = new Map<string, OAuthPendingState>();
    private readonly sessions = new Map<string, OAuthSession>();

    async createPendingState(mode: OAuthMode, scopes: string[]): Promise<OAuthPendingState> {
        const pending: OAuthPendingState = {
            state: randomUUID(),
            mode,
            scopes,
            createdAt: new Date().toISOString(),
        };
        this.pendingStates.set(pending.state, pending);
        return pending;
    }

    async consumePendingState(state: string): Promise<OAuthPendingState | null> {
        const pending = this.pendingStates.get(state) ?? null;
        if (pending) {
            this.pendingStates.delete(state);
        }
        return pending;
    }

    async createSession(session: Omit<OAuthSession, 'id'>): Promise<OAuthSession> {
        const stored: OAuthSession = {
            ...session,
            id: randomUUID(),
        };
        this.sessions.set(stored.id, stored);
        return stored;
    }

    async consumeSession(sessionId: string): Promise<OAuthSession | null> {
        const session = this.sessions.get(sessionId) ?? null;
        if (session) {
            this.sessions.delete(sessionId);
        }
        return session;
    }
}
