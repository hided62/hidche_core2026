import { TRPCError } from '@trpc/server';

import type { GameApiContext } from '../context.js';
import { buildAuctionTimerKeys } from './keys.js';

export type OpenAuctionInput =
    | {
          auctionType: 'BUY_RICE' | 'SELL_RICE';
          amount: number;
          closeTurnCnt: number;
          startBidAmount: number;
          finishBidAmount: number;
      }
    | {
          auctionType: 'UNIQUE_ITEM';
          amount: number;
          itemKey: string;
      };

export const openAuctionWithDaemon = async (
    ctx: GameApiContext,
    generalId: number,
    input: OpenAuctionInput
): Promise<{ auctionId: number; closeAt: string }> => {
    const result = await ctx.turnDaemon.requestCommand({
        type: 'auctionOpen',
        generalId,
        ...input,
    });
    if (!result || result.type !== 'auctionOpen') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
    }
    if (!result.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
    }

    const timerKeys = buildAuctionTimerKeys(ctx.profile.name);
    const closeAt = new Date(result.closeAt);
    await ctx.redis.zAdd(timerKeys.timerKey, [{ score: closeAt.getTime(), value: String(result.auctionId) }]);
    return {
        auctionId: result.auctionId,
        closeAt: result.closeAt,
    };
};
