import { randomUUID } from 'node:crypto';

import type {
    GameSessionInfo,
    GatewaySessionConfig,
    GatewaySessionInfo,
    GatewaySessionService,
    SessionRevocationOptions,
} from './sessionService.js';
import type { UserRecord } from './userRepository.js';

interface StoredSession {
    info: GatewaySessionInfo;
    expiresAt: number;
}

interface StoredGameSession {
    info: GameSessionInfo;
    expiresAt: number;
}

const buildGameKey = (profile: string, gameToken: string): string => `${profile}:${gameToken}`;

// 세션 TTL 동작을 테스트할 수 있도록 메모리 기반 구현을 제공한다.
export class InMemoryGatewaySessionService implements GatewaySessionService {
    private readonly sessions = new Map<string, StoredSession>();
    private readonly gameSessions = new Map<string, StoredGameSession>();
    private readonly sessionGames = new Map<string, Set<string>>();
    private readonly sessionTtlMs: number;
    private readonly gameSessionTtlMs: number;

    constructor(config: GatewaySessionConfig) {
        this.sessionTtlMs = config.sessionTtlSeconds * 1000;
        this.gameSessionTtlMs = config.gameSessionTtlSeconds * 1000;
    }

    async createSession(user: UserRecord): Promise<GatewaySessionInfo> {
        const sessionToken = randomUUID();
        const info: GatewaySessionInfo = {
            sessionToken,
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
            roles: user.roles,
            sanctions: user.sanctions,
            createdAt: user.createdAt,
            issuedAt: new Date().toISOString(),
        };
        this.sessions.set(sessionToken, {
            info,
            expiresAt: Date.now() + this.sessionTtlMs,
        });
        return info;
    }

    async getSession(sessionToken: string): Promise<GatewaySessionInfo | null> {
        const stored = this.sessions.get(sessionToken);
        if (!stored) {
            return null;
        }
        if (Date.now() > stored.expiresAt) {
            this.sessions.delete(sessionToken);
            this.sessionGames.delete(sessionToken);
            return null;
        }
        return stored.info;
    }

    async revokeSession(
        sessionToken: string,
        options: SessionRevocationOptions = { revokeGames: true }
    ): Promise<void> {
        if (options.revokeGames ?? true) {
            const gameKeys = this.sessionGames.get(sessionToken);
            if (gameKeys) {
                for (const key of gameKeys) {
                    this.gameSessions.delete(key);
                }
            }
            this.sessionGames.delete(sessionToken);
        }
        this.sessions.delete(sessionToken);
    }

    async createGameSession(sessionToken: string, profile: string): Promise<GameSessionInfo | null> {
        const session = await this.getSession(sessionToken);
        if (!session) {
            return null;
        }
        const gameToken = randomUUID();
        const info: GameSessionInfo = {
            profile,
            gameToken,
            sessionToken,
            userId: session.userId,
            username: session.username,
            displayName: session.displayName,
            roles: session.roles,
            sanctions: session.sanctions,
            createdAt: session.createdAt,
            issuedAt: new Date().toISOString(),
        };
        const key = buildGameKey(profile, gameToken);
        this.gameSessions.set(key, {
            info,
            expiresAt: Date.now() + this.gameSessionTtlMs,
        });
        const set = this.sessionGames.get(sessionToken) ?? new Set<string>();
        set.add(key);
        this.sessionGames.set(sessionToken, set);
        return info;
    }

    async getGameSession(profile: string, gameToken: string): Promise<GameSessionInfo | null> {
        const key = buildGameKey(profile, gameToken);
        const stored = this.gameSessions.get(key);
        if (!stored) {
            return null;
        }
        if (Date.now() > stored.expiresAt) {
            this.gameSessions.delete(key);
            return null;
        }
        return stored.info;
    }
}
