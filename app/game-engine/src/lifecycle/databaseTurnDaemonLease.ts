import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { createGamePostgresConnector, GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';

export interface TurnDaemonLeaseToken {
    profile: string;
    ownerId: string;
    fencingEpoch: bigint;
}

export interface DatabaseTurnDaemonLeaseOptions {
    profile: string;
    ownerId?: string;
    leaseDurationMs?: number;
    heartbeat?: boolean;
}

export class TurnDaemonLeaseUnavailableError extends Error {
    constructor(profile: string) {
        super(`Another turn daemon holds the active lease for profile "${profile}".`);
        this.name = 'TurnDaemonLeaseUnavailableError';
    }
}

export class TurnDaemonLeaseLostError extends Error {
    constructor(profile: string) {
        super(`Turn daemon lease was lost for profile "${profile}".`);
        this.name = 'TurnDaemonLeaseLostError';
    }
}

type LeaseRow = {
    profile: string;
    owner_id: string;
    fencing_epoch: bigint;
};

const normalizeLeaseDuration = (value?: number): number => Math.max(1_000, Math.floor(value ?? 30_000));

export class DatabaseTurnDaemonLease {
    private readonly db: GamePrismaClient;
    private readonly disconnect: () => Promise<void>;
    private readonly profile: string;
    private readonly ownerId: string;
    private readonly leaseDurationMs: number;
    private readonly heartbeatEnabled: boolean;
    private token: TurnDaemonLeaseToken | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private expiryTimer: NodeJS.Timeout | null = null;
    private renewalInFlight = false;
    private lost = false;

    private constructor(
        db: GamePrismaClient,
        disconnect: () => Promise<void>,
        options: DatabaseTurnDaemonLeaseOptions
    ) {
        this.db = db;
        this.disconnect = disconnect;
        this.profile = options.profile;
        this.ownerId = options.ownerId ?? randomUUID();
        this.leaseDurationMs = normalizeLeaseDuration(options.leaseDurationMs);
        this.heartbeatEnabled = options.heartbeat ?? true;
    }

    static async connect(
        databaseUrl: string,
        options: DatabaseTurnDaemonLeaseOptions
    ): Promise<DatabaseTurnDaemonLease> {
        const connector = createGamePostgresConnector({ url: databaseUrl });
        await connector.connect();
        return new DatabaseTurnDaemonLease(connector.prisma, () => connector.disconnect(), options);
    }

    async acquire(): Promise<TurnDaemonLeaseToken | null> {
        const requestStartedAt = performance.now();
        const rows = await this.db.$queryRaw<LeaseRow[]>(GamePrisma.sql`
            INSERT INTO "turn_daemon_lease" (
                "profile",
                "owner_id",
                "lease_until",
                "fencing_epoch",
                "heartbeat_at"
            )
            VALUES (
                ${this.profile},
                ${this.ownerId},
                CURRENT_TIMESTAMP + (${this.leaseDurationMs} * INTERVAL '1 millisecond'),
                1,
                CURRENT_TIMESTAMP
            )
            ON CONFLICT ("profile") DO UPDATE
            SET
                "owner_id" = EXCLUDED."owner_id",
                "lease_until" = EXCLUDED."lease_until",
                "fencing_epoch" = CASE
                    WHEN "turn_daemon_lease"."owner_id" = EXCLUDED."owner_id"
                        THEN "turn_daemon_lease"."fencing_epoch"
                    ELSE "turn_daemon_lease"."fencing_epoch" + 1
                END,
                "heartbeat_at" = CURRENT_TIMESTAMP
            WHERE
                "turn_daemon_lease"."owner_id" = EXCLUDED."owner_id"
                OR "turn_daemon_lease"."lease_until" <= CURRENT_TIMESTAMP
            RETURNING "profile", "owner_id", "fencing_epoch"
        `);
        const row = rows[0];
        if (!row) {
            return null;
        }
        this.token = {
            profile: row.profile,
            ownerId: row.owner_id,
            fencingEpoch: BigInt(row.fencing_epoch),
        };
        this.lost = false;
        this.scheduleExpiryWatchdog(requestStartedAt);
        if (this.heartbeatEnabled) {
            this.startHeartbeat();
        }
        return this.token;
    }

    getToken(): TurnDaemonLeaseToken | null {
        return this.token ? { ...this.token } : null;
    }

    isLost(): boolean {
        return this.lost;
    }

    async renew(): Promise<boolean> {
        const token = this.token;
        if (!token || this.lost || this.renewalInFlight) {
            return false;
        }
        const requestStartedAt = performance.now();
        this.renewalInFlight = true;
        try {
            const rows = await this.db.$queryRaw<LeaseRow[]>(GamePrisma.sql`
                UPDATE "turn_daemon_lease"
                SET
                    "lease_until" = CURRENT_TIMESTAMP + (${this.leaseDurationMs} * INTERVAL '1 millisecond'),
                    "heartbeat_at" = CURRENT_TIMESTAMP
                WHERE
                    "profile" = ${token.profile}
                    AND "owner_id" = ${token.ownerId}
                    AND "fencing_epoch" = ${token.fencingEpoch}
                    AND "lease_until" > CURRENT_TIMESTAMP
                RETURNING "profile", "owner_id", "fencing_epoch"
            `);
            if (rows.length === 0) {
                this.markLost();
                return false;
            }
            if (this.lost) {
                return false;
            }
            this.scheduleExpiryWatchdog(requestStartedAt);
            return true;
        } finally {
            this.renewalInFlight = false;
        }
    }

    async assertActive(transaction?: GamePrisma.TransactionClient): Promise<void> {
        const token = this.token;
        if (!token || this.lost) {
            throw new TurnDaemonLeaseLostError(this.profile);
        }
        const db = transaction ?? this.db;
        const rows = await db.$queryRaw<LeaseRow[]>(GamePrisma.sql`
            SELECT "profile", "owner_id", "fencing_epoch"
            FROM "turn_daemon_lease"
            WHERE
                "profile" = ${token.profile}
                AND "owner_id" = ${token.ownerId}
                AND "fencing_epoch" = ${token.fencingEpoch}
                AND "lease_until" > CURRENT_TIMESTAMP
            FOR UPDATE
        `);
        if (rows.length === 0) {
            this.markLost();
            throw new TurnDaemonLeaseLostError(this.profile);
        }
    }

    async release(): Promise<void> {
        this.stopHeartbeat();
        this.stopExpiryWatchdog();
        const token = this.token;
        this.token = null;
        if (!token || this.lost) {
            return;
        }
        await this.db.$executeRaw(GamePrisma.sql`
            UPDATE "turn_daemon_lease"
            SET "lease_until" = CURRENT_TIMESTAMP, "heartbeat_at" = CURRENT_TIMESTAMP
            WHERE
                "profile" = ${token.profile}
                AND "owner_id" = ${token.ownerId}
                AND "fencing_epoch" = ${token.fencingEpoch}
        `);
    }

    async close(): Promise<void> {
        try {
            await this.release();
        } finally {
            await this.disconnect();
        }
    }

    private startHeartbeat(): void {
        if (this.heartbeatTimer) {
            return;
        }
        const intervalMs = Math.max(250, Math.floor(this.leaseDurationMs / 3));
        this.heartbeatTimer = setInterval(() => {
            void this.renew().catch(() => {
                this.markLost();
            });
        }, intervalMs);
        this.heartbeatTimer.unref();
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private scheduleExpiryWatchdog(requestStartedAt: number): void {
        // DB가 lease_until을 정하는 시점보다 앞선 요청 시작 시각을 기준으로
        // 잡아, heartbeat 응답이 멈춰도 DB lease 만료보다 늦게 pause하지 않는다.
        this.stopExpiryWatchdog();
        const remainingMs = Math.max(0, this.leaseDurationMs - (performance.now() - requestStartedAt));
        this.expiryTimer = setTimeout(() => {
            this.markLost();
        }, remainingMs);
        this.expiryTimer.unref();
    }

    private stopExpiryWatchdog(): void {
        if (this.expiryTimer) {
            clearTimeout(this.expiryTimer);
            this.expiryTimer = null;
        }
    }

    private markLost(): void {
        this.lost = true;
        this.stopHeartbeat();
        this.stopExpiryWatchdog();
    }
}
