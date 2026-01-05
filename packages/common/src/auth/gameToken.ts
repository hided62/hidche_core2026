import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface UserSanctions {
    bannedUntil?: string;
    mutedUntil?: string;
    suspendedUntil?: string;
    warningCount?: number;
    flags?: string[];
    notes?: string;
    profileIconResetAt?: string;
    serverRestrictions?: Record<string, UserServerRestriction>;
}

export interface UserServerRestriction {
    blockedFeatures?: string[];
    until?: string;
    reason?: string;
    notes?: string;
}

export interface GatewayUserInfo {
    id: string;
    username: string;
    displayName: string;
    roles: string[];
    createdAt?: string;
}

export interface GameSessionTokenPayload {
    version: 1;
    profile: string;
    issuedAt: string;
    expiresAt: string;
    sessionId: string;
    user: GatewayUserInfo;
    sanctions: UserSanctions;
}

const toBase64Url = (data: Buffer): string => data.toString('base64url');
const fromBase64Url = (value: string): Buffer => Buffer.from(value, 'base64url');

const buildKey = (secret: string): Buffer => createHash('sha256').update(secret).digest();

export const encryptGameSessionToken = (payload: GameSessionTokenPayload, secret: string): string => {
    const iv = randomBytes(12);
    const key = buildKey(secret);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${toBase64Url(iv)}.${toBase64Url(ciphertext)}.${toBase64Url(tag)}`;
};

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
    const user = payload.user as Partial<GatewayUserInfo>;
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

export const decryptGameSessionToken = (token: string, secret: string): GameSessionTokenPayload | null => {
    const parts = token.split('.');
    if (parts.length !== 3) {
        return null;
    }
    try {
        const [ivPart, cipherPart, tagPart] = parts;
        const iv = fromBase64Url(ivPart);
        const ciphertext = fromBase64Url(cipherPart);
        const tag = fromBase64Url(tagPart);
        const key = buildKey(secret);
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        return parsePayload(JSON.parse(plaintext));
    } catch {
        return null;
    }
};
