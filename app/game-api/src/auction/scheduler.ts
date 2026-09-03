import { GamePrisma } from '@sammo-ts/infra';

import type { DatabaseClient } from '../context.js';
import type { AuctionTimerRow } from './types.js';
import type { AuctionTimerKeys } from './keys.js';
import { loadCurrentGameTime, type CurrentGameTime } from '../services/gameClock.js';

interface RedisSortedSetClient {
    zAdd(key: string, values: Array<{ score: number; value: string }>): Promise<number>;
}

export const resolveAuctionTimerScore = (time: CurrentGameTime, closeAt: Date, closeTick?: bigint | null): number => {
    void time;
    void closeAt;
    if (closeTick === null || closeTick === undefined) throw new Error('Auction close tick is required.');
    const value = Number(closeTick);
    if (!Number.isSafeInteger(value)) throw new Error(`Auction close tick is unsafe: ${closeTick}`);
    return value;
};

export const resolveAuctionSeedScore = (time: CurrentGameTime, row: AuctionTimerRow): number => {
    if (row.status === 'FINALIZING') {
        // 마감 판정은 이미 끝났으므로 원래 deadline을 기다리지 않고 durable event 복구를 즉시 재시도한다.
        if (time.tick === null) throw new Error('Current game tick is required for auction recovery.');
        return time.tick;
    }
    return resolveAuctionTimerScore(time, row.closeAt, row.closeTick);
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
        score: resolveAuctionSeedScore(gameTime, row),
        value: String(row.id),
    }));
    await redis.zAdd(keys.timerKey, payload);
    return payload.length;
};
