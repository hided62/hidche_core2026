import { randomUUID } from 'node:crypto';

import { parseGameSessionTokenPayload, type GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { isValid, parseISO } from 'date-fns';

interface RedisClientLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { EX?: number; NX?: boolean }): Promise<string | null>;
    del?(key: string): Promise<number>;
    eval?(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

const ACCESS_TOKEN_PREFIX = 'ga_';

const buildAccessKey = (profileName: string, token: string): string => `sammo:game:access:${profileName}:${token}`;

const buildGatewayUsedKey = (profileName: string, sessionId: string): string =>
    `sammo:game:gateway-used:${profileName}:${sessionId}`;

const ISSUE_FROM_GATEWAY_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
    return 0
end
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[1], '1', 'EX', ARGV[2])
return 1
`;

const resolveTtlSeconds = (expiresAt: string): number => {
    const parsed = parseISO(expiresAt);
    if (!isValid(parsed)) {
        return 0;
    }
    const ttl = Math.floor((parsed.getTime() - Date.now()) / 1000);
    return ttl > 0 ? ttl : 0;
};

export class RedisAccessTokenStore {
    private readonly client: RedisClientLike;
    private readonly profileName: string;

    constructor(client: RedisClientLike, profileName: string) {
        this.client = client;
        this.profileName = profileName;
    }

    static isAccessToken(token: string): boolean {
        return token.startsWith(ACCESS_TOKEN_PREFIX);
    }

    async create(payload: GameSessionTokenPayload): Promise<{ accessToken: string; expiresAt: string } | null> {
        const ttlSeconds = resolveTtlSeconds(payload.expiresAt);
        if (ttlSeconds <= 0) {
            return null;
        }
        const accessToken = `${ACCESS_TOKEN_PREFIX}${randomUUID()}`;
        const key = buildAccessKey(this.profileName, accessToken);
        await this.client.set(key, JSON.stringify(payload), { EX: ttlSeconds });
        return { accessToken, expiresAt: payload.expiresAt };
    }

    async issueFromGateway(
        payload: GameSessionTokenPayload
    ): Promise<{ accessToken: string; expiresAt: string } | null | 'ALREADY_USED'> {
        const ttlSeconds = resolveTtlSeconds(payload.expiresAt);
        if (ttlSeconds <= 0) {
            return null;
        }
        if (!this.client.eval) {
            throw new Error('Redis client does not support atomic gateway token exchange.');
        }
        const accessToken = `${ACCESS_TOKEN_PREFIX}${randomUUID()}`;
        const accessKey = buildAccessKey(this.profileName, accessToken);
        const usedKey = buildGatewayUsedKey(this.profileName, payload.sessionId);
        const result = await this.client.eval(ISSUE_FROM_GATEWAY_SCRIPT, {
            keys: [usedKey, accessKey],
            arguments: [JSON.stringify(payload), String(ttlSeconds)],
        });
        if (Number(result) === 0) {
            return 'ALREADY_USED';
        }
        if (Number(result) !== 1) {
            throw new Error('Unexpected Redis result while issuing an access token.');
        }
        return { accessToken, expiresAt: payload.expiresAt };
    }

    async get(accessToken: string): Promise<GameSessionTokenPayload | null> {
        if (!RedisAccessTokenStore.isAccessToken(accessToken)) {
            return null;
        }
        const key = buildAccessKey(this.profileName, accessToken);
        const raw = await this.client.get(key);
        if (!raw) {
            return null;
        }
        try {
            const payload = parseGameSessionTokenPayload(JSON.parse(raw));
            if (!payload) {
                return null;
            }
            const ttl = resolveTtlSeconds(payload.expiresAt);
            if (ttl <= 0) {
                return null;
            }
            return payload;
        } catch {
            return null;
        }
    }

    async revoke(accessToken: string): Promise<boolean> {
        if (!RedisAccessTokenStore.isAccessToken(accessToken)) {
            return false;
        }
        if (!this.client.del) {
            throw new Error('Redis client does not support access token revocation.');
        }
        const key = buildAccessKey(this.profileName, accessToken);
        return (await this.client.del(key)) > 0;
    }
}
