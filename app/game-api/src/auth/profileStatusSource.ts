import { createHmac } from 'node:crypto';
import { GATEWAY_PROFILE_STATUSES, type GatewayProfileStatus } from '@sammo-ts/common';

const INTERNAL_TOKEN_CONTEXT = 'sammo:profile-status-source:v1';
const profileStatuses = new Set<string>(GATEWAY_PROFILE_STATUSES);

export interface ProfileStatusSource {
    get(profileName: string): Promise<GatewayProfileStatus | null>;
}

const deriveInternalToken = (secret: string): string =>
    createHmac('sha256', secret).update(INTERNAL_TOKEN_CONTEXT).digest('hex');

const parseProfileStatus = (value: unknown, profileName: string): GatewayProfileStatus => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('invalid gateway profile status projection');
    }
    const record = value as Record<string, unknown>;
    if (
        Object.keys(record).sort().join(',') !== 'profileName,status' ||
        record.profileName !== profileName ||
        typeof record.status !== 'string' ||
        !profileStatuses.has(record.status)
    ) {
        throw new Error('invalid gateway profile status projection');
    }
    return record.status as GatewayProfileStatus;
};

export class GatewayHttpProfileStatusSource implements ProfileStatusSource {
    private readonly baseUrl: string;

    constructor(
        baseUrl: string,
        private readonly secret: string,
        private readonly timeoutMs = 2_000
    ) {
        this.baseUrl = baseUrl.replace(/\/$/u, '');
    }

    async get(profileName: string): Promise<GatewayProfileStatus | null> {
        const response = await fetch(`${this.baseUrl}/internal/profile-status/${encodeURIComponent(profileName)}`, {
            headers: {
                'x-sammo-internal-token': deriveInternalToken(this.secret),
            },
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.status === 404) {
            return null;
        }
        if (!response.ok) {
            throw new Error(`Gateway profile status request failed with HTTP ${response.status}.`);
        }
        return parseProfileStatus(await response.json(), profileName);
    }
}
