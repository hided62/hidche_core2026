import { randomUUID } from 'node:crypto';

import { createGatewayRedisKeyBuilder } from './redisKeys.js';
import type {
    GameSessionInfo,
    GatewaySessionConfig,
    GatewaySessionInfo,
    GatewaySessionService,
    SessionRevocationOptions,
} from './sessionService.js';
import type { UserRecord } from './userRepository.js';

interface RedisGatewaySessionOptions extends GatewaySessionConfig {
    keyPrefix: string;
}

interface RedisPipeline {
    set(key: string, value: string, options?: { EX?: number }): RedisPipeline;
    sAdd(key: string, member: string): RedisPipeline;
    expire(key: string, seconds: number): RedisPipeline;
    del(key: string): RedisPipeline;
    exec(): Promise<unknown>;
}

interface RedisClientLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
    sMembers(key: string): Promise<string[]>;
    multi(): RedisPipeline;
    del(key: string): Promise<number>;
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

// Redis 세션 저장소는 게이트웨이와 게임 서버 간 SSO 토큰을 관리한다.
export class RedisGatewaySessionService implements GatewaySessionService {
    private readonly client: RedisClientLike;
    private readonly keys: ReturnType<typeof createGatewayRedisKeyBuilder>;
    private readonly sessionTtlSeconds: number;
    private readonly gameSessionTtlSeconds: number;

    constructor(client: RedisClientLike, options: RedisGatewaySessionOptions) {
        this.client = client;
        this.keys = createGatewayRedisKeyBuilder(options.keyPrefix);
        this.sessionTtlSeconds = options.sessionTtlSeconds;
        this.gameSessionTtlSeconds = options.gameSessionTtlSeconds;
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
        await this.client.set(this.keys.sessionKey(sessionToken), JSON.stringify(info), {
            EX: this.sessionTtlSeconds,
        });
        return info;
    }

    async getSession(sessionToken: string): Promise<GatewaySessionInfo | null> {
        const raw = await this.client.get(this.keys.sessionKey(sessionToken));
        return parseJson<GatewaySessionInfo>(raw);
    }

    async revokeSession(
        sessionToken: string,
        options: SessionRevocationOptions = { revokeGames: true }
    ): Promise<void> {
        const key = this.keys.sessionKey(sessionToken);
        if (options.revokeGames ?? true) {
            const gameSetKey = this.keys.sessionGameSetKey(sessionToken);
            const games = await this.client.sMembers(gameSetKey);
            if (games.length > 0) {
                const pipeline = this.client.multi();
                for (const entry of games) {
                    pipeline.del(entry);
                }
                pipeline.del(gameSetKey);
                pipeline.del(key);
                await pipeline.exec();
                return;
            }
            await this.client.del(gameSetKey);
        }
        await this.client.del(key);
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
        const gameKey = this.keys.gameSessionKey(profile, gameToken);
        const gameSetKey = this.keys.sessionGameSetKey(sessionToken);
        await this.client
            .multi()
            .set(gameKey, JSON.stringify(info), { EX: this.gameSessionTtlSeconds })
            .sAdd(gameSetKey, gameKey)
            .expire(gameSetKey, this.sessionTtlSeconds)
            .exec();
        return info;
    }

    async getGameSession(profile: string, gameToken: string): Promise<GameSessionInfo | null> {
        const raw = await this.client.get(this.keys.gameSessionKey(profile, gameToken));
        return parseJson<GameSessionInfo>(raw);
    }
}
