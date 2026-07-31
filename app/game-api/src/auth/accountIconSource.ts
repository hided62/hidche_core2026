import { isCanonicalIsoTimestamp, parseAccountIconProjection, type AccountIconProjection } from '@sammo-ts/common';
import { createHmac } from 'node:crypto';

const INTERNAL_TOKEN_CONTEXT = 'sammo:account-icon-source:v1';

export interface AccountIconSource {
    get(userId: string): Promise<AccountIconProjection | null>;
}

export interface AccountIconResetProjection {
    userId: string;
    resetRevision: string;
    current: AccountIconProjection;
}

export interface AccountIconResetSource {
    listResets(userIds: string[]): Promise<AccountIconResetProjection[]>;
}

const deriveInternalToken = (secret: string): string =>
    createHmac('sha256', secret).update(INTERNAL_TOKEN_CONTEXT).digest('hex');

const parseResetProjection = (value: unknown): AccountIconResetProjection => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('invalid account icon reset projection');
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'current,resetRevision,userId') {
        throw new Error('invalid account icon reset projection');
    }
    if (
        typeof record.userId !== 'string' ||
        typeof record.resetRevision !== 'string' ||
        !isCanonicalIsoTimestamp(record.resetRevision)
    ) {
        throw new Error('invalid account icon reset projection');
    }
    return {
        userId: record.userId,
        resetRevision: record.resetRevision,
        current: parseAccountIconProjection(record.current),
    };
};

export class GatewayHttpAccountIconSource implements AccountIconSource, AccountIconResetSource {
    private readonly baseUrl: string;

    constructor(
        baseUrl: string,
        private readonly secret: string,
        private readonly timeoutMs = 2_000
    ) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    async get(userId: string): Promise<AccountIconProjection | null> {
        const response = await fetch(`${this.baseUrl}/internal/account-icons/${encodeURIComponent(userId)}`, {
            headers: {
                'x-sammo-internal-token': deriveInternalToken(this.secret),
            },
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.status === 404) {
            return null;
        }
        if (!response.ok) {
            throw new Error(`Gateway account icon request failed with HTTP ${response.status}.`);
        }
        return parseAccountIconProjection(await response.json());
    }

    async listResets(userIds: string[]): Promise<AccountIconResetProjection[]> {
        if (userIds.length === 0) {
            return [];
        }
        const response = await fetch(`${this.baseUrl}/internal/account-icon-resets`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-sammo-internal-token': deriveInternalToken(this.secret),
            },
            body: JSON.stringify({ userIds }),
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
            throw new Error(`Gateway account icon reset request failed with HTTP ${response.status}.`);
        }
        const payload = (await response.json()) as unknown;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new Error('invalid account icon reset response');
        }
        const record = payload as Record<string, unknown>;
        if (Object.keys(record).sort().join(',') !== 'resets' || !Array.isArray(record.resets)) {
            throw new Error('invalid account icon reset response');
        }
        const resets = record.resets.map(parseResetProjection);
        const requested = new Set(userIds);
        if (
            resets.some((reset) => !requested.has(reset.userId)) ||
            new Set(resets.map((reset) => reset.userId)).size !== resets.length
        ) {
            throw new Error('invalid account icon reset response');
        }
        return resets;
    }
}
