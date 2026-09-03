import { performance } from 'node:perf_hooks';

import { gatewayProfileCapabilities } from '@sammo-ts/common';
import { GamePrisma } from '@sammo-ts/infra';

import type { ProfileStatusSource } from '../auth/profileStatusSource.js';

interface TurnDaemonLeaseSource {
    $queryRaw<T>(query: GamePrisma.Sql): Promise<T>;
}

export const loadTurnEngineRunning = async (
    source: ProfileStatusSource | undefined,
    db: TurnDaemonLeaseSource,
    profileName: string,
    now?: Date
): Promise<boolean | null> => {
    if (!source) return null;
    try {
        const status = await source.get(profileName);
        if (status === null) return null;
        if (!gatewayProfileCapabilities(status).turnsRunning) return false;
        const wallNow = now
            ? GamePrisma.sql`${now}`
            : GamePrisma.sql`(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;
        const rows = await db.$queryRaw<Array<{ running: boolean }>>(GamePrisma.sql`
            SELECT EXISTS (
                SELECT 1
                FROM turn_daemon_lease
                WHERE profile = ${profileName}
                  AND lease_until > ${wallNow}
            ) AS running
        `);
        return rows[0]?.running ?? false;
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
        private readonly now = () => performance.now()
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
