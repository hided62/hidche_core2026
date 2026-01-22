import { GamePrisma } from '@sammo-ts/infra';

import type { DatabaseClient } from '../context.js';
import type { AuctionTimerRow } from './types.js';
import type { AuctionTimerKeys } from './keys.js';

interface RedisSortedSetClient {
    zAdd(key: string, values: Array<{ score: number; value: string }>): Promise<number>;
    zRem(key: string, values: string | string[]): Promise<number>;
}

export interface AuctionEventUpdate {
    auctionId: number;
    closeAt: Date;
    eventId: string;
    eventAt: Date;
}

export const seedAuctionTimers = async (
    db: DatabaseClient,
    redis: RedisSortedSetClient,
    keys: AuctionTimerKeys
): Promise<number> => {
    const rows = await db.$queryRaw<AuctionTimerRow[]>(
        GamePrisma.sql`SELECT id, close_at as "closeAt", status FROM auction WHERE status = 'OPEN'`
    );
    if (!rows.length) {
        return 0;
    }

    const payload = rows.map((row) => ({ score: row.closeAt.getTime(), value: String(row.id) }));
    await redis.zAdd(keys.timerKey, payload);
    return payload.length;
};

export const applyAuctionEvent = async (
    db: DatabaseClient,
    redis: RedisSortedSetClient,
    keys: AuctionTimerKeys,
    event: AuctionEventUpdate
): Promise<boolean> => {
    const now = new Date();
    const updated = await db.$executeRaw(
        GamePrisma.sql`
            UPDATE auction
            SET close_at = ${event.closeAt},
                latest_event_id = ${event.eventId},
                latest_event_at = ${event.eventAt},
                updated_at = ${now}
            WHERE id = ${event.auctionId}
              AND status = 'OPEN'
              AND (
                latest_event_at < ${event.eventAt}
                OR (latest_event_at = ${event.eventAt} AND latest_event_id < ${event.eventId})
              )
        `
    );

    if (updated > 0) {
        await redis.zAdd(keys.timerKey, [{ score: event.closeAt.getTime(), value: String(event.auctionId) }]);
        return true;
    }

    return false;
};

export const removeAuctionTimer = async (
    redis: RedisSortedSetClient,
    keys: AuctionTimerKeys,
    auctionId: number
): Promise<void> => {
    await redis.zRem(keys.timerKey, String(auctionId));
};
