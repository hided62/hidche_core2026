import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';

export const REALTIME_ACCESS_GRANT_TTL_MS = 15_000;

type RealtimeAccessGrantPayload = {
    version: 1;
    profile: string;
    sessionId: string;
    userId: string;
    expiresAt: number;
};

const GRANT_KEY_CONTEXT = 'sammo:realtime-access-grant:v1';
const MAX_GRANT_LENGTH = 1_024;

interface RedisClientLike {
    set(key: string, value: string, options: { NX: true; PX: number }): Promise<string | null>;
    eval?(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

const CONSUME_GRANT_SCRIPT = `
if redis.call('DEL', KEYS[1]) == 1 then
    return 1
end
return 0
`;

const buildKey = (secret: string): Buffer =>
    createHash('sha256').update(GRANT_KEY_CONTEXT).update('\0').update(secret).digest();

const buildUsageKey = (profileName: string, grant: string): string =>
    `sammo:game:realtime-access-grant:${profileName}:${createHash('sha256').update(grant).digest('base64url')}`;

const parsePayload = (value: unknown): RealtimeAccessGrantPayload | null => {
    if (!value || typeof value !== 'object') return null;
    const payload = value as Partial<RealtimeAccessGrantPayload>;
    if (
        payload.version !== 1 ||
        typeof payload.profile !== 'string' ||
        typeof payload.sessionId !== 'string' ||
        typeof payload.userId !== 'string' ||
        typeof payload.expiresAt !== 'number' ||
        !Number.isSafeInteger(payload.expiresAt)
    ) {
        return null;
    }
    return payload as RealtimeAccessGrantPayload;
};

export const createRealtimeAccessGrant = (
    auth: GameSessionTokenPayload,
    profileName: string,
    secret: string,
    now = new Date()
): string => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', buildKey(secret), iv);
    const payload: RealtimeAccessGrantPayload = {
        version: 1,
        profile: profileName,
        sessionId: auth.sessionId,
        userId: auth.user.id,
        expiresAt: now.getTime() + REALTIME_ACCESS_GRANT_TTL_MS,
    };
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return [iv, encrypted, cipher.getAuthTag()].map((part) => part.toString('base64url')).join('.');
};

export const verifyRealtimeAccessGrant = (
    grant: string | null | undefined,
    auth: GameSessionTokenPayload | null,
    profileName: string,
    secret: string,
    now = new Date()
): boolean => {
    if (!grant || grant.length > MAX_GRANT_LENGTH || !auth) return false;
    const parts = grant.split('.');
    if (parts.length !== 3) return false;
    try {
        const [ivPart, encryptedPart, tagPart] = parts;
        const decipher = createDecipheriv('aes-256-gcm', buildKey(secret), Buffer.from(ivPart, 'base64url'));
        decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(encryptedPart, 'base64url')),
            decipher.final(),
        ]).toString('utf8');
        const payload = parsePayload(JSON.parse(plaintext));
        return Boolean(
            payload &&
            payload.expiresAt > now.getTime() &&
            payload.profile === profileName &&
            payload.sessionId === auth.sessionId &&
            payload.userId === auth.user.id
        );
    } catch {
        return false;
    }
};

export const verifyRealtimeAccessGrantHeader = (
    header: string | string[] | undefined,
    auth: GameSessionTokenPayload | null,
    profileName: string,
    secret: string,
    now = new Date()
): boolean => verifyRealtimeAccessGrant(Array.isArray(header) ? header[0] : header, auth, profileName, secret, now);

export const registerRealtimeAccessGrant = async (
    redis: RedisClientLike,
    grant: string,
    profileName: string
): Promise<boolean> =>
    (await redis.set(buildUsageKey(profileName, grant), '1', {
        NX: true,
        PX: REALTIME_ACCESS_GRANT_TTL_MS,
    })) === 'OK';

export const consumeRealtimeAccessGrantHeader = async (
    redis: RedisClientLike,
    header: string | string[] | undefined,
    auth: GameSessionTokenPayload | null,
    profileName: string,
    secret: string,
    now = new Date()
): Promise<boolean> => {
    const grant = Array.isArray(header) ? header[0] : header;
    if (!verifyRealtimeAccessGrant(grant, auth, profileName, secret, now) || !grant || !redis.eval) {
        return false;
    }
    try {
        return (
            Number(
                await redis.eval(CONSUME_GRANT_SCRIPT, {
                    keys: [buildUsageKey(profileName, grant)],
                    arguments: [],
                })
            ) === 1
        );
    } catch {
        return false;
    }
};
