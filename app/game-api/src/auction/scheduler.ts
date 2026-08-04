import { GamePrisma } from '@sammo-ts/infra';

import type { DatabaseClient } from '../context.js';
import type { AuctionTimerRow } from './types.js';
import type { AuctionTimerKeys } from './keys.js';
import { loadCurrentGameTime, type CurrentGameTime } from '../services/gameClock.js';

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

export const resolveAuctionTimerScore = (time: CurrentGameTime, closeAt: Date, closeTick?: bigint | null): number => {
    if (closeTick !== null && closeTick !== undefined) {
        const value = Number(closeTick);
        if (!Number.isSafeInteger(value)) throw new Error(`Auction close tick is unsafe: ${closeTick}`);
        return value;
    }
    return time.dateToTick(closeAt) ?? closeAt.getTime();
};

export const seedAuctionTimers = async (
    db: DatabaseClient,
    redis: RedisSortedSetClient,
    keys: AuctionTimerKeys
): Promise<number> => {
    const rows = await db.$queryRaw<AuctionTimerRow[]>(
        GamePrisma.sql`
            SELECT id, close_at as "closeAt", close_tick as "closeTick", status
            FROM auction
            WHERE status IN ('OPEN', 'FINALIZING')
        `
    );
    if (!rows.length) {
        return 0;
    }

    const gameTime = await loadCurrentGameTime(db);
    const payload = rows.map((row) => ({
        score: resolveAuctionTimerScore(gameTime, row.closeAt, row.closeTick),
        value: String(row.id),
    }));
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
    const gameTime = await loadCurrentGameTime(db, now);
    const closeTick = gameTime.dateToTick(event.closeAt);
    const updated = await db.$executeRaw(
        GamePrisma.sql`
            UPDATE auction
            SET close_at = ${event.closeAt},
                close_tick = ${closeTick === null ? null : BigInt(closeTick)},
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
        await redis.zAdd(keys.timerKey, [
            {
                score: resolveAuctionTimerScore(gameTime, event.closeAt, closeTick === null ? null : BigInt(closeTick)),
                value: String(event.auctionId),
            },
        ]);
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
