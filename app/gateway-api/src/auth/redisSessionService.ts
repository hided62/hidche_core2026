import { randomUUID } from 'node:crypto';
import { parseJson } from '@sammo-ts/common';

import { createGatewayRedisKeyBuilder } from './redisKeys.js';
import { GameSessionLimitError, MAX_GAME_SESSIONS_PER_SESSION } from './sessionService.js';
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

interface RedisClientLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
    del(key: string): Promise<number>;
}

// 부모 확인·만료 항목 정리·상한·새 항목 저장을 한 원자적 경계에서 수행한다.
// 기존 oversized index는 SMEMBERS로 펼치지 않고 발급을 거절한다.
const CREATE_GAME_SESSION_SCRIPT = `
local parentTtl = redis.call('PTTL', KEYS[1])
if parentTtl <= 0 or redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local limit = tonumber(ARGV[4])
if redis.call('SCARD', KEYS[2]) > limit then return -1 end
for _, entry in ipairs(redis.call('SMEMBERS', KEYS[2])) do
    if redis.call('EXISTS', entry) == 0 then redis.call('SREM', KEYS[2], entry) end
end
if redis.call('SCARD', KEYS[2]) >= limit then return -1 end
redis.call('SET', KEYS[3], ARGV[2], 'EX', ARGV[3])
redis.call('SADD', KEYS[2], KEYS[3])
redis.call('PEXPIRE', KEYS[2], math.max(parentTtl, tonumber(ARGV[3]) * 1000))
return 1
`;

// 삭제와 index pop도 한 경계다. 중간 실패에서 추적만 잃는 것을 방지한다.
const REVOKE_GAME_SESSION_BATCH_SCRIPT = `
redis.call('DEL', KEYS[1])
local entries = redis.call('SPOP', KEYS[2], 64)
for _, entry in ipairs(entries) do redis.call('DEL', entry) end
return #entries
`;

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
            authRevision: user.authRevision ?? 0,
            legacyMemberNo: user.legacyMemberNo,
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
        if (!(options.revokeGames ?? true)) {
            await this.client.del(key);
            return;
        }
        // 부모 제거와 각 64개 삭제를 원자적으로 처리한다. 이후 발급 Lua는 실패한다.
        // 이전 버전에서 커진 index도 응답/transaction 한 번에 전부 펼치지 않는다.
        for (;;) {
            const count = await this.client.eval(REVOKE_GAME_SESSION_BATCH_SCRIPT, {
                keys: [key, this.keys.sessionGameSetKey(sessionToken)],
                arguments: [],
            });
            if (typeof count !== 'number' || count < 0 || count > 64)
                throw new Error('Unexpected game session revocation result.');
            if (count < 64) break;
        }
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
            authRevision: session.authRevision ?? 0,
            legacyMemberNo: session.legacyMemberNo,
        };
        const gameKey = this.keys.gameSessionKey(profile, gameToken);
        const gameSetKey = this.keys.sessionGameSetKey(sessionToken);
        const result = await this.client.eval(CREATE_GAME_SESSION_SCRIPT, {
            keys: [this.keys.sessionKey(sessionToken), gameSetKey, gameKey],
            arguments: [
                JSON.stringify(session),
                JSON.stringify(info),
                String(this.gameSessionTtlSeconds),
                String(MAX_GAME_SESSIONS_PER_SESSION),
            ],
        });
        if (result === 0) return null;
        if (result === -1) throw new GameSessionLimitError();
        if (result !== 1) throw new Error('Unexpected game session admission result.');
        return info;
    }

    async getGameSession(profile: string, gameToken: string): Promise<GameSessionInfo | null> {
        const raw = await this.client.get(this.keys.gameSessionKey(profile, gameToken));
        return parseJson<GameSessionInfo>(raw);
    }
}
