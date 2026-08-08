import { randomUUID } from 'node:crypto';
import { parseJson } from '@sammo-ts/common';

export type OAuthMode = 'login' | 'change_pw' | 'verify';

export interface OAuthPendingState {
    state: string;
    mode: OAuthMode;
    scopes: string[];
    userId?: string;
    createdAt: string;
}

export interface OAuthSession {
    id: string;
    mode: OAuthMode;
    intent?: 'register' | 'link_existing' | 'rejoin';
    targetUserId?: string;
    kakaoId: string;
    email: string;
    accessToken: string;
    refreshToken?: string;
    accessTokenValidUntil: string;
    refreshTokenValidUntil?: string;
    createdAt: string;
}

export interface KakaoLoginChallenge {
    id: string;
    userId: string;
    code: string;
    attemptsRemaining: number;
    expiresAt: string;
    createdAt: string;
}

export type KakaoLoginChallengeResult =
    | { status: 'verified'; userId: string }
    | { status: 'mismatch'; attemptsRemaining: number; expiresAt: string }
    | { status: 'locked'; expiresAt: string }
    | { status: 'expired' };

export interface OAuthSessionStore {
    createPendingState(mode: OAuthMode, scopes: string[], userId?: string): Promise<OAuthPendingState>;
    consumePendingState(state: string): Promise<OAuthPendingState | null>;
    createSession(session: Omit<OAuthSession, 'id'>): Promise<OAuthSession>;
    consumeSession(sessionId: string): Promise<OAuthSession | null>;
    getLoginChallengeForUser(userId: string): Promise<KakaoLoginChallenge | null>;
    createLoginChallenge(challenge: Omit<KakaoLoginChallenge, 'id'>): Promise<KakaoLoginChallenge>;
    verifyLoginChallenge(challengeId: string, code: string, now?: Date): Promise<KakaoLoginChallengeResult>;
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
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
    multi(): RedisPipeline;
}

const verifyLoginChallengeScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then
    return '{"status":"expired"}'
end

local challenge = cjson.decode(raw)
if challenge.attemptsRemaining <= 0 then
    return cjson.encode({ status = 'locked', expiresAt = challenge.expiresAt })
end

if tostring(challenge.code) ~= ARGV[1] then
    challenge.attemptsRemaining = challenge.attemptsRemaining - 1
    redis.call('SET', KEYS[1], cjson.encode(challenge), 'KEEPTTL')
    return cjson.encode({
        status = 'mismatch',
        attemptsRemaining = challenge.attemptsRemaining,
        expiresAt = challenge.expiresAt
    })
end

redis.call('DEL', KEYS[1])
local userKey = ARGV[2] .. challenge.userId
if redis.call('GET', userKey) == challenge.id then
    redis.call('DEL', userKey)
end
return cjson.encode({ status = 'verified', userId = challenge.userId })
`;

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

    private loginChallengeKey(challengeId: string): string {
        return `${this.prefix}:kakao-login-challenge:${challengeId}`;
    }

    private userLoginChallengeKey(userId: string): string {
        return `${this.prefix}:kakao-login-challenge-user:${userId}`;
    }

    private challengeTtlSeconds(expiresAt: string): number {
        return Math.max(1, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
    }

    async createPendingState(mode: OAuthMode, scopes: string[], userId?: string): Promise<OAuthPendingState> {
        const state: OAuthPendingState = {
            state: randomUUID(),
            mode,
            scopes,
            userId,
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

    async getLoginChallengeForUser(userId: string): Promise<KakaoLoginChallenge | null> {
        const challengeId = await this.client.get(this.userLoginChallengeKey(userId));
        if (!challengeId) {
            return null;
        }
        const raw = await this.client.get(this.loginChallengeKey(challengeId));
        if (!raw) {
            await this.client.del(this.userLoginChallengeKey(userId));
            return null;
        }
        const challenge = parseJson<KakaoLoginChallenge>(raw);
        if (!challenge) {
            await this.client.del(this.userLoginChallengeKey(userId));
            return null;
        }
        if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
            await this.client
                .multi()
                .del(this.loginChallengeKey(challenge.id))
                .del(this.userLoginChallengeKey(userId))
                .exec();
            return null;
        }
        return challenge;
    }

    async createLoginChallenge(challenge: Omit<KakaoLoginChallenge, 'id'>): Promise<KakaoLoginChallenge> {
        const stored: KakaoLoginChallenge = {
            ...challenge,
            id: randomUUID(),
        };
        const ttlSeconds = this.challengeTtlSeconds(stored.expiresAt);
        await this.client
            .multi()
            .set(this.loginChallengeKey(stored.id), JSON.stringify(stored), { EX: ttlSeconds })
            .set(this.userLoginChallengeKey(stored.userId), stored.id, { EX: ttlSeconds })
            .exec();
        return stored;
    }

    async verifyLoginChallenge(challengeId: string, code: string): Promise<KakaoLoginChallengeResult> {
        const raw = await this.client.eval(verifyLoginChallengeScript, {
            keys: [this.loginChallengeKey(challengeId)],
            arguments: [code, `${this.prefix}:kakao-login-challenge-user:`],
        });
        const result = typeof raw === 'string' ? parseJson<KakaoLoginChallengeResult>(raw) : null;
        return result ?? { status: 'expired' };
    }
}

// 테스트용 인메모리 OAuth 세션 저장소.
export class InMemoryOAuthSessionStore implements OAuthSessionStore {
    private readonly pendingStates = new Map<string, OAuthPendingState>();
    private readonly sessions = new Map<string, OAuthSession>();
    private readonly loginChallenges = new Map<string, KakaoLoginChallenge>();
    private readonly userLoginChallenges = new Map<string, string>();

    async createPendingState(mode: OAuthMode, scopes: string[], userId?: string): Promise<OAuthPendingState> {
        const pending: OAuthPendingState = {
            state: randomUUID(),
            mode,
            scopes,
            userId,
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

    async getLoginChallengeForUser(userId: string): Promise<KakaoLoginChallenge | null> {
        const challengeId = this.userLoginChallenges.get(userId);
        const challenge = challengeId ? this.loginChallenges.get(challengeId) : undefined;
        if (!challenge || new Date(challenge.expiresAt).getTime() <= Date.now()) {
            if (challengeId) {
                this.loginChallenges.delete(challengeId);
            }
            this.userLoginChallenges.delete(userId);
            return null;
        }
        return challenge;
    }

    async createLoginChallenge(challenge: Omit<KakaoLoginChallenge, 'id'>): Promise<KakaoLoginChallenge> {
        const stored: KakaoLoginChallenge = {
            ...challenge,
            id: randomUUID(),
        };
        this.loginChallenges.set(stored.id, stored);
        this.userLoginChallenges.set(stored.userId, stored.id);
        return stored;
    }

    async verifyLoginChallenge(
        challengeId: string,
        code: string,
        now = new Date()
    ): Promise<KakaoLoginChallengeResult> {
        const challenge = this.loginChallenges.get(challengeId);
        if (!challenge || new Date(challenge.expiresAt).getTime() <= now.getTime()) {
            if (challenge) {
                this.loginChallenges.delete(challengeId);
                if (this.userLoginChallenges.get(challenge.userId) === challengeId) {
                    this.userLoginChallenges.delete(challenge.userId);
                }
            }
            return { status: 'expired' };
        }
        if (challenge.attemptsRemaining <= 0) {
            return { status: 'locked', expiresAt: challenge.expiresAt };
        }
        if (challenge.code !== code) {
            challenge.attemptsRemaining -= 1;
            return {
                status: 'mismatch',
                attemptsRemaining: challenge.attemptsRemaining,
                expiresAt: challenge.expiresAt,
            };
        }
        this.loginChallenges.delete(challengeId);
        if (this.userLoginChallenges.get(challenge.userId) === challengeId) {
            this.userLoginChallenges.delete(challenge.userId);
        }
        return { status: 'verified', userId: challenge.userId };
    }
}
