import { randomUUID } from 'node:crypto';

import type { GameSessionTokenPayload } from '@sammo-ts/common';
import { isValid, parseISO } from 'date-fns';

interface RedisClientLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { EX?: number; NX?: boolean }): Promise<string | null>;
}

const ACCESS_TOKEN_PREFIX = 'ga_';

const buildAccessKey = (profileName: string, token: string): string =>
    `sammo:game:access:${profileName}:${token}`;

const buildGatewayUsedKey = (profileName: string, sessionId: string): string =>
    `sammo:game:gateway-used:${profileName}:${sessionId}`;

const parsePayload = (value: unknown): GameSessionTokenPayload | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const payload = value as Partial<GameSessionTokenPayload>;
    if (payload.version !== 1) {
        return null;
    }
    if (typeof payload.profile !== 'string') {
        return null;
    }
    if (typeof payload.issuedAt !== 'string' || typeof payload.expiresAt !== 'string') {
        return null;
    }
    if (typeof payload.sessionId !== 'string') {
        return null;
    }
    if (!payload.user || typeof payload.user !== 'object') {
        return null;
    }
    const user = payload.user as Partial<GameSessionTokenPayload['user']>;
    if (
        typeof user.id !== 'string' ||
        typeof user.username !== 'string' ||
        typeof user.displayName !== 'string' ||
        !Array.isArray(user.roles)
    ) {
        return null;
    }
    if (!payload.sanctions || typeof payload.sanctions !== 'object') {
        return null;
    }
    return payload as GameSessionTokenPayload;
};

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
            const payload = parsePayload(JSON.parse(raw));
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

    async markGatewayTokenUsed(sessionId: string, ttlSeconds: number): Promise<boolean> {
        if (ttlSeconds <= 0) {
            return false;
        }
        const key = buildGatewayUsedKey(this.profileName, sessionId);
        const result = await this.client.set(key, '1', { NX: true, EX: ttlSeconds });
        return result === 'OK';
    }
}
