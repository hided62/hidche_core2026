import { gatewayProfileCapabilities } from '@sammo-ts/common';

import type { ProfileStatusSource } from '../auth/profileStatusSource.js';

interface TurnDaemonLeaseSource {
    turnDaemonLease: {
        findUnique(input: {
            where: { profile: string };
            select: { leaseUntil: true };
        }): Promise<{ leaseUntil: Date } | null>;
    };
}

export const loadTurnEngineRunning = async (
    source: ProfileStatusSource | undefined,
    db: TurnDaemonLeaseSource,
    profileName: string,
    now = new Date()
): Promise<boolean | null> => {
    if (!source) return null;
    try {
        const status = await source.get(profileName);
        if (status === null) return null;
        if (!gatewayProfileCapabilities(status).turnsRunning) return false;
        const lease = await db.turnDaemonLease.findUnique({
            where: { profile: profileName },
            select: { leaseUntil: true },
        });
        return lease !== null && lease.leaseUntil.getTime() > now.getTime();
    } catch {
        return null;
    }
};

export class CachedTurnEngineStatus {
    private cachedAt = Number.NEGATIVE_INFINITY;
    private cachedValue: boolean | null = null;
    private pending: Promise<boolean | null> | null = null;

    constructor(
        private readonly source: ProfileStatusSource,
        private readonly db: TurnDaemonLeaseSource,
        private readonly profileName: string,
        private readonly cacheMs = 2_000,
        private readonly now = () => Date.now()
    ) {}

    get(): Promise<boolean | null> {
        if (this.now() - this.cachedAt < this.cacheMs) {
            return Promise.resolve(this.cachedValue);
        }
        if (this.pending) return this.pending;

        this.pending = loadTurnEngineRunning(this.source, this.db, this.profileName).then((value) => {
            this.cachedValue = value;
            this.cachedAt = this.now();
            return value;
        });
        return this.pending.finally(() => {
            this.pending = null;
        });
    }
}
