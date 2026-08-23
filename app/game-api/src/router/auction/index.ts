import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, engineAuthedProcedure, router } from '../../trpc.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../../context.js';
import { buildAuctionTimerKeys } from '../../auction/keys.js';
import { GamePrisma } from '@sammo-ts/infra';
import { ItemLoader, isItemKey } from '@sammo-ts/logic';
import { asNumber, asRecord } from '@sammo-ts/common';
import { buildAuctionAlias } from '@sammo-ts/logic';
import { openAuctionWithDaemon } from '../../auction/open.js';
import { resolveAuctionTimerScore } from '../../auction/scheduler.js';
import { loadCurrentGameTime } from '../../services/gameClock.js';

const zBidInput = z.object({
    auctionId: z.number().int().positive(),
    amount: z.number().int().positive(),
});

const zUniqueBidInput = zBidInput.extend({
    tryExtendCloseDate: z.boolean().optional(),
});

const zOpenResourceInput = z.object({
    amount: z.number().int().min(100).max(10_000),
    closeTurnCnt: z.number().int().min(1).max(24),
    startBidAmount: z.number().int().positive(),
    finishBidAmount: z.number().int().positive(),
});

const zOpenUniqueInput = z.object({
    itemKey: z.string(),
    amount: z.number().int().positive(),
});

type AuctionType = 'BUY_RICE' | 'SELL_RICE' | 'UNIQUE_ITEM';

interface AuctionRow {
    id: number;
    type: AuctionType;
    targetCode: string | null;
    hostGeneralId: number;
    detail: unknown;
    status: string;
    closeAt: Date;
    closeTick: bigint | null;
}

export interface AuctionDetail {
    title?: string;
    amount?: number;
    isReverse?: boolean;
    startBidAmount?: number;
    finishBidAmount?: number | null;
    availableLatestBidCloseDate?: string | null;
    remainCloseDateExtensionCnt?: number | null;
}

export const hasAuctionClosePassed = (
    auction: { closeAt: Date; closeTick: bigint | null },
    time: { now: Date; tick: number | null }
): boolean =>
    auction.closeTick !== null && time.tick !== null
        ? auction.closeTick < BigInt(time.tick)
        : auction.closeAt.getTime() < time.now.getTime();

interface AuctionBidRow {
    id: number;
    generalId: number;
    amount: number;
    meta: Record<string, unknown>;
}

const parseDetail = (detail: unknown): AuctionDetail => {
    if (!detail || typeof detail !== 'object') {
        return {};
    }
    return detail as AuctionDetail;
};

const requireAuth = (ctx: GameApiContext): NonNullable<GameApiContext['auth']> => {
    if (!ctx.auth) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Unauthorized',
        });
    }
    return ctx.auth;
};

const ensureGeneral = async (db: DatabaseClient, userId: string): Promise<GeneralRow> => {
    const general = await db.general.findFirst({
        where: { userId },
    });
    if (!general) {
        throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'General not found.',
        });
    }
    return general;
};

const ensureAuctionSeasonActive = async (db: DatabaseClient): Promise<void> => {
    const worldState = await db.worldState.findFirst({ select: { meta: true } });
    const meta = asRecord(worldState?.meta);
    if (asNumber(meta.isUnited, 0) !== 0 || asNumber(meta.isunited, 0) !== 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '천하통일 후에는 경매를 이용할 수 없습니다.' });
    }
};

const loadAuction = async (db: DatabaseClient, auctionId: number): Promise<AuctionRow | null> => {
    const rows = (await db.$queryRaw(
        GamePrisma.sql`
            SELECT id,
                type,
                target_code as "targetCode",
                host_general_id as "hostGeneralId",
                detail,
                status,
                close_at as "closeAt",
                close_tick as "closeTick"
            FROM auction
            WHERE id = ${auctionId}
        `
    )) as AuctionRow[];
    return rows[0] ?? null;
};

const loadHighestBid = async (
    db: DatabaseClient,
    auctionId: number,
    isReverse: boolean
): Promise<AuctionBidRow | null> => {
    const rows = (await db.$queryRaw(
        isReverse
            ? GamePrisma.sql`
                SELECT id, general_id as "generalId", amount, meta
                FROM auction_bid
                WHERE auction_id = ${auctionId}
                ORDER BY amount ASC, id ASC
                LIMIT 1
              `
            : GamePrisma.sql`
                SELECT id, general_id as "generalId", amount, meta
                FROM auction_bid
                WHERE auction_id = ${auctionId}
                ORDER BY amount DESC, id ASC
                LIMIT 1
              `
    )) as AuctionBidRow[];
    return rows[0] ?? null;
};

const loadMyPrevBid = async (
    db: DatabaseClient,
    auctionId: number,
    generalId: number,
    isReverse: boolean
): Promise<AuctionBidRow | null> => {
    const rows = (await db.$queryRaw(
        isReverse
            ? GamePrisma.sql`
                SELECT id, general_id as "generalId", amount, meta
                FROM auction_bid
                WHERE auction_id = ${auctionId} AND general_id = ${generalId}
                ORDER BY amount ASC, id ASC
                LIMIT 1
              `
            : GamePrisma.sql`
                SELECT id, general_id as "generalId", amount, meta
                FROM auction_bid
                WHERE auction_id = ${auctionId} AND general_id = ${generalId}
                ORDER BY amount DESC, id ASC
                LIMIT 1
              `
    )) as AuctionBidRow[];
    return rows[0] ?? null;
};

const shouldUsePrevBid = (highestBid: AuctionBidRow | null, myPrevBid: AuctionBidRow | null): AuctionBidRow | null => {
    if (!myPrevBid) {
        return null;
    }
    if (!highestBid) {
        return myPrevBid;
    }
    if (highestBid.id !== myPrevBid.id) {
        return null;
    }
    return myPrevBid;
};

const MIN_AUCTION_REMAINING_RESOURCE = 1_000;

export const auctionRouter = router({
    getOverview: authedProcedure.query(async ({ ctx }) => {
        const auth = requireAuth(ctx);
        const general = await ensureGeneral(ctx.db, auth.user.id);
        const [auctions, worldState, point, recentLogs] = await Promise.all([
            ctx.db.auction.findMany({
                where: {
                    OR: [{ type: { in: ['BUY_RICE', 'SELL_RICE'] }, status: 'OPEN' }, { type: 'UNIQUE_ITEM' }],
                },
                orderBy: [{ status: 'asc' }, { id: 'desc' }],
                take: 120,
                include: {
                    bids: {
                        orderBy: [{ amount: 'desc' }, { id: 'asc' }],
                    },
                },
            }),
            ctx.db.worldState.findFirst(),
            ctx.db.inheritancePoint.findUnique({
                where: { userId_key: { userId: auth.user.id, key: 'previous' } },
            }),
            ctx.db.logEntry.findMany({
                where: { text: { contains: '경매' } },
                orderBy: { id: 'desc' },
                take: 20,
                select: { id: true, text: true, createdAt: true },
            }),
        ]);
        const generalIds = new Set<number>();
        for (const auction of auctions) {
            if (auction.type !== 'UNIQUE_ITEM' && auction.hostGeneralId > 0) {
                generalIds.add(auction.hostGeneralId);
            }
            for (const bid of auction.bids) {
                if (auction.type !== 'UNIQUE_ITEM') {
                    generalIds.add(bid.generalId);
                }
            }
        }
        const names = new Map(
            (
                await ctx.db.general.findMany({
                    where: { id: { in: [...generalIds] } },
                    select: { id: true, name: true },
                })
            ).map((row) => [row.id, row.name])
        );
        const worldMeta = asRecord(worldState?.meta);
        const configConst = asRecord(asRecord(worldState?.config).const);
        const hiddenSeed =
            typeof worldMeta.hiddenSeed === 'string' || typeof worldMeta.hiddenSeed === 'number'
                ? worldMeta.hiddenSeed
                : (worldState?.id ?? 0);
        const callerAlias = buildAuctionAlias(general.id, hiddenSeed, configConst);

        const mapped = auctions.map((auction) => {
            const detail = parseDetail(auction.detail);
            const highestBid = auction.bids[0] ?? null;
            const isUnique = auction.type === 'UNIQUE_ITEM';
            return {
                id: auction.id,
                type: auction.type,
                targetCode: auction.targetCode,
                status: auction.status,
                hostGeneralId: isUnique ? null : auction.hostGeneralId,
                hostName: isUnique
                    ? (auction.hostName ?? buildAuctionAlias(auction.hostGeneralId, hiddenSeed, configConst))
                    : (auction.hostName ?? names.get(auction.hostGeneralId) ?? '상인'),
                isCallerHost: auction.hostGeneralId === general.id,
                closeAt: auction.closeAt.toISOString(),
                detail,
                highestBid: highestBid
                    ? {
                          amount: highestBid.amount,
                          bidderName: isUnique
                              ? buildAuctionAlias(highestBid.generalId, hiddenSeed, configConst)
                              : (names.get(highestBid.generalId) ?? '상인'),
                          isCaller: highestBid.generalId === general.id,
                          eventAt: highestBid.eventAt.toISOString(),
                      }
                    : null,
            };
        });

        return {
            resourceAuctions: mapped.filter((auction) => auction.type !== 'UNIQUE_ITEM'),
            uniqueAuctions: mapped.filter((auction) => auction.type === 'UNIQUE_ITEM'),
            callerAlias,
            remainPoint: point?.value ?? 0,
            recentLogs: recentLogs.map((log) => ({
                id: log.id,
                text: log.text,
                createdAt: log.createdAt.toISOString(),
            })),
        };
    }),
    getUniqueDetail: authedProcedure
        .input(z.object({ auctionId: z.number().int().positive() }))
        .query(async ({ ctx, input }) => {
            const auth = requireAuth(ctx);
            const general = await ensureGeneral(ctx.db, auth.user.id);
            const [auction, worldState, point] = await Promise.all([
                ctx.db.auction.findFirst({
                    where: { id: input.auctionId, type: 'UNIQUE_ITEM' },
                    include: { bids: { orderBy: [{ amount: 'desc' }, { id: 'asc' }] } },
                }),
                ctx.db.worldState.findFirst(),
                ctx.db.inheritancePoint.findUnique({
                    where: { userId_key: { userId: auth.user.id, key: 'previous' } },
                }),
            ]);
            if (!auction) {
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Auction not found.' });
            }
            const worldMeta = asRecord(worldState?.meta);
            const configConst = asRecord(asRecord(worldState?.config).const);
            const hiddenSeed =
                typeof worldMeta.hiddenSeed === 'string' || typeof worldMeta.hiddenSeed === 'number'
                    ? worldMeta.hiddenSeed
                    : (worldState?.id ?? 0);
            return {
                auction: {
                    id: auction.id,
                    targetCode: auction.targetCode,
                    status: auction.status,
                    hostName: auction.hostName ?? buildAuctionAlias(auction.hostGeneralId, hiddenSeed, configConst),
                    isCallerHost: auction.hostGeneralId === general.id,
                    closeAt: auction.closeAt.toISOString(),
                    detail: parseDetail(auction.detail),
                },
                bids: auction.bids.map((bid) => ({
                    id: bid.id,
                    amount: bid.amount,
                    bidderName: buildAuctionAlias(bid.generalId, hiddenSeed, configConst),
                    isCaller: bid.generalId === general.id,
                    eventAt: bid.eventAt.toISOString(),
                })),
                callerAlias: buildAuctionAlias(general.id, hiddenSeed, configConst),
                remainPoint: point?.value ?? 0,
            };
        }),
    openBuyRice: engineAuthedProcedure.input(zOpenResourceInput).mutation(async ({ ctx, input }) => {
        const auth = requireAuth(ctx);
        const general = await ensureGeneral(ctx.db, auth.user.id);
        await ensureAuctionSeasonActive(ctx.db);
        return openAuctionWithDaemon(
            ctx,
            general.id,
            { auctionType: 'BUY_RICE', ...input },
            ctx.requestId ? `${ctx.requestId}:auction.openBuyRice:engine:0:auctionOpen` : undefined
        );
    }),
    openSellRice: engineAuthedProcedure.input(zOpenResourceInput).mutation(async ({ ctx, input }) => {
        const auth = requireAuth(ctx);
        const general = await ensureGeneral(ctx.db, auth.user.id);
        await ensureAuctionSeasonActive(ctx.db);
        return openAuctionWithDaemon(
            ctx,
            general.id,
            { auctionType: 'SELL_RICE', ...input },
            ctx.requestId ? `${ctx.requestId}:auction.openSellRice:engine:0:auctionOpen` : undefined
        );
    }),
    openUnique: engineAuthedProcedure.input(zOpenUniqueInput).mutation(async ({ ctx, input }) => {
        const auth = requireAuth(ctx);
        const general = await ensureGeneral(ctx.db, auth.user.id);
        await ensureAuctionSeasonActive(ctx.db);
        return openAuctionWithDaemon(
            ctx,
            general.id,
            {
                auctionType: 'UNIQUE_ITEM',
                itemKey: input.itemKey,
                amount: input.amount,
            },
            ctx.requestId ? `${ctx.requestId}:auction.openUnique:engine:0:auctionOpen` : undefined
        );
    }),
    bidBuyRice: engineAuthedProcedure.input(zBidInput).mutation(async ({ ctx, input }) => {
        const auth = requireAuth(ctx);
        const general = await ensureGeneral(ctx.db, auth.user.id);
        await ensureAuctionSeasonActive(ctx.db);
        const auction = await loadAuction(ctx.db, input.auctionId);
        if (!auction || auction.type !== 'BUY_RICE') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Auction not found.' });
        }
        if (auction.status !== 'OPEN') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '경매가 종료되었습니다.' });
        }

        const gameTime = await loadCurrentGameTime(ctx.db);
        if (hasAuctionClosePassed(auction, gameTime)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '경매가 종료되었습니다.' });
        }
        if (auction.hostGeneralId === general.id) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '자신이 연 경매에 입찰할 수 없습니다.' });
        }

        const detail = parseDetail(auction.detail);
        const amount = detail.amount ?? 0;
        if (amount <= 0) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '거래량 정보가 없습니다.' });
        }
        const isReverse = detail.isReverse === true;
        if (!isReverse && detail.finishBidAmount != null && input.amount > detail.finishBidAmount) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '즉시판매가보다 높을 수 없습니다.' });
        }
        const highestBid = await loadHighestBid(ctx.db, auction.id, isReverse);
        const myPrevBidRaw = await loadMyPrevBid(ctx.db, auction.id, general.id, isReverse);
        const myPrevBid = shouldUsePrevBid(highestBid, myPrevBidRaw);

        if (!highestBid && detail.startBidAmount && input.amount < detail.startBidAmount) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '시작가보다 낮습니다.' });
        }
        if (!isReverse && highestBid && input.amount <= highestBid.amount) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '현재입찰가보다 높게 입찰해야 합니다.' });
        }
        if (isReverse && highestBid && input.amount >= highestBid.amount) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '현재입찰가보다 낮게 입찰해야 합니다.' });
        }

        const morePoint = input.amount - (myPrevBid?.amount ?? 0);
        if (morePoint <= 0) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '입찰가가 유효하지 않습니다.' });
        }
        if (general.gold < morePoint + MIN_AUCTION_REMAINING_RESOURCE) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '금이 부족합니다.' });
        }

        const result = await ctx.turnDaemon.requestCommand({
            type: 'auctionBid',
            ...(ctx.requestId ? { requestId: `${ctx.requestId}:auction.bidBuyRice:engine:0:auctionBid` } : {}),
            auctionId: auction.id,
            generalId: general.id,
            amount: input.amount,
            ...(gameTime.tick === null ? {} : { acceptedGameTick: gameTime.tick }),
            tryExtendCloseDate: true,
        });
        if (!result || result.type !== 'auctionBid') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            const code = result.reason.includes('취소') ? 'CONFLICT' : 'BAD_REQUEST';
            throw new TRPCError({ code, message: result.reason });
        }

        const timerKeys = buildAuctionTimerKeys(ctx.profile.name);
        const nextCloseAt = new Date(result.closeAt);
        await ctx.redis.zAdd(timerKeys.timerKey, [
            { score: resolveAuctionTimerScore(gameTime, nextCloseAt), value: String(auction.id) },
        ]);

        return { ok: true };
    }),
    bidSellRice: engineAuthedProcedure.input(zBidInput).mutation(async ({ ctx, input }) => {
        const auth = requireAuth(ctx);
        const general = await ensureGeneral(ctx.db, auth.user.id);
        await ensureAuctionSeasonActive(ctx.db);
        const auction = await loadAuction(ctx.db, input.auctionId);
        if (!auction || auction.type !== 'SELL_RICE') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Auction not found.' });
        }
        if (auction.status !== 'OPEN') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '경매가 종료되었습니다.' });
        }

        const gameTime = await loadCurrentGameTime(ctx.db);
        if (hasAuctionClosePassed(auction, gameTime)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '경매가 종료되었습니다.' });
        }
        if (auction.hostGeneralId === general.id) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '자신이 연 경매에 입찰할 수 없습니다.' });
        }

        const detail = parseDetail(auction.detail);
        const amount = detail.amount ?? 0;
        if (amount <= 0) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '거래량 정보가 없습니다.' });
        }
        const isReverse = detail.isReverse === true;
        if (!isReverse && detail.finishBidAmount != null && input.amount > detail.finishBidAmount) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '즉시판매가보다 높을 수 없습니다.' });
        }
        const highestBid = await loadHighestBid(ctx.db, auction.id, isReverse);
        const myPrevBidRaw = await loadMyPrevBid(ctx.db, auction.id, general.id, isReverse);
        const myPrevBid = shouldUsePrevBid(highestBid, myPrevBidRaw);

        if (!highestBid && detail.startBidAmount && input.amount < detail.startBidAmount) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '시작가보다 낮습니다.' });
        }
        if (!isReverse && highestBid && input.amount <= highestBid.amount) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '현재입찰가보다 높게 입찰해야 합니다.' });
        }
        if (isReverse && highestBid && input.amount >= highestBid.amount) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '현재입찰가보다 낮게 입찰해야 합니다.' });
        }

        const morePoint = input.amount - (myPrevBid?.amount ?? 0);
        if (morePoint <= 0) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '입찰가가 유효하지 않습니다.' });
        }
        if (general.rice < morePoint + MIN_AUCTION_REMAINING_RESOURCE) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '쌀이 부족합니다.' });
        }

        const result = await ctx.turnDaemon.requestCommand({
            type: 'auctionBid',
            ...(ctx.requestId ? { requestId: `${ctx.requestId}:auction.bidSellRice:engine:0:auctionBid` } : {}),
            auctionId: auction.id,
            generalId: general.id,
            amount: input.amount,
            ...(gameTime.tick === null ? {} : { acceptedGameTick: gameTime.tick }),
            tryExtendCloseDate: true,
        });
        if (!result || result.type !== 'auctionBid') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            const code = result.reason.includes('취소') ? 'CONFLICT' : 'BAD_REQUEST';
            throw new TRPCError({ code, message: result.reason });
        }

        const timerKeys = buildAuctionTimerKeys(ctx.profile.name);
        const nextCloseAt = new Date(result.closeAt);
        await ctx.redis.zAdd(timerKeys.timerKey, [
            { score: resolveAuctionTimerScore(gameTime, nextCloseAt), value: String(auction.id) },
        ]);

        return { ok: true };
    }),
    bidUnique: engineAuthedProcedure.input(zUniqueBidInput).mutation(async ({ ctx, input }) => {
        const auth = requireAuth(ctx);
        const general = await ensureGeneral(ctx.db, auth.user.id);
        await ensureAuctionSeasonActive(ctx.db);
        const auction = await loadAuction(ctx.db, input.auctionId);
        if (!auction || auction.type !== 'UNIQUE_ITEM') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Auction not found.' });
        }
        if (auction.status !== 'OPEN') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '경매가 종료되었습니다.' });
        }

        const gameTime = await loadCurrentGameTime(ctx.db);
        if (hasAuctionClosePassed(auction, gameTime)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '경매가 종료되었습니다.' });
        }

        const detail = parseDetail(auction.detail);
        const isReverse = detail.isReverse === true;
        const highestBid = await loadHighestBid(ctx.db, auction.id, isReverse);
        const myPrevBidRaw = await loadMyPrevBid(ctx.db, auction.id, general.id, isReverse);
        const myPrevBid = shouldUsePrevBid(highestBid, myPrevBidRaw);

        if (highestBid) {
            if (input.amount < highestBid.amount * 1.01) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '현재입찰가보다 1% 높게 입찰해야 합니다.' });
            }
            if (input.amount < highestBid.amount + 10) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '현재입찰가보다 10 포인트 높게 입찰해야 합니다.' });
            }
        } else if (detail.startBidAmount && input.amount < detail.startBidAmount) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '시작가보다 낮습니다.' });
        }

        const itemKey = auction.targetCode;
        if (!itemKey || !isItemKey(itemKey)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '아이템이 올바르지 않습니다.' });
        }
        const itemLoader = new ItemLoader();
        const itemModule = await itemLoader.load(itemKey);
        if (itemModule.buyable) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '구매할 수 있는 아이템입니다.' });
        }

        const ownedItems = [general.horseCode, general.weaponCode, general.bookCode, general.itemCode].filter(
            (value) => value && value !== 'None'
        ) as string[];
        for (const owned of ownedItems) {
            if (!isItemKey(owned)) {
                continue;
            }
            const ownedModule = await itemLoader.load(owned);
            if (!ownedModule.buyable && ownedModule.slot === itemModule.slot) {
                if (owned === itemKey) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 그 유니크를 가지고 있습니다.' });
                }
                throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 다른 유니크를 가지고 있습니다.' });
            }
        }

        const openUniqueRows = (await ctx.db.$queryRaw(
            GamePrisma.sql`
                SELECT id, target_code as "targetCode"
                FROM auction
                WHERE status = 'OPEN' AND type = 'UNIQUE_ITEM'
            `
        )) as Array<{ id: number; targetCode: string }>;
        if (openUniqueRows.length > 0) {
            const auctionIds = openUniqueRows.map((row) => row.id);
            const highestRows = (await ctx.db.$queryRaw(
                GamePrisma.sql`
                    SELECT bid.auction_id as "auctionId", bid.general_id as "generalId", bid.amount
                    FROM auction_bid bid
                    INNER JOIN (
                        SELECT auction_id, MAX(amount) as max_amount
                        FROM auction_bid
                        WHERE auction_id IN (${GamePrisma.join(auctionIds)})
                        GROUP BY auction_id
                    ) max_bid
                    ON bid.auction_id = max_bid.auction_id AND bid.amount = max_bid.max_amount
                `
            )) as Array<{ auctionId: number; generalId: number; amount: number }>;
            for (const row of highestRows) {
                if (row.generalId !== general.id || row.auctionId === auction.id) {
                    continue;
                }
                const other = openUniqueRows.find((entry) => entry.id === row.auctionId);
                if (!other || !other.targetCode || !isItemKey(other.targetCode)) {
                    continue;
                }
                const otherItem = await itemLoader.load(other.targetCode);
                if (otherItem.slot === itemModule.slot) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: '1순위 입찰자인 경매중에 같은 부위가 있습니다.',
                    });
                }
            }
        }

        const morePoint = input.amount - (myPrevBid?.amount ?? 0);
        if (morePoint <= 0) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '입찰가가 유효하지 않습니다.' });
        }

        const inheritPoint = await ctx.db.inheritancePoint.findUnique({
            where: { userId_key: { userId: auth.user.id, key: 'previous' } },
        });
        if ((inheritPoint?.value ?? 0) < morePoint) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '유산포인트가 부족합니다.' });
        }

        const result = await ctx.turnDaemon.requestCommand({
            type: 'auctionBid',
            ...(ctx.requestId ? { requestId: `${ctx.requestId}:auction.bidUnique:engine:0:auctionBid` } : {}),
            auctionId: auction.id,
            generalId: general.id,
            amount: input.amount,
            ...(gameTime.tick === null ? {} : { acceptedGameTick: gameTime.tick }),
            tryExtendCloseDate: input.tryExtendCloseDate ?? false,
        });
        if (!result || result.type !== 'auctionBid') {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
        }
        if (!result.ok) {
            const code = result.reason.includes('취소') ? 'CONFLICT' : 'BAD_REQUEST';
            throw new TRPCError({ code, message: result.reason });
        }

        const timerKeys = buildAuctionTimerKeys(ctx.profile.name);
        const nextCloseAt = new Date(result.closeAt);
        await ctx.redis.zAdd(timerKeys.timerKey, [
            { score: resolveAuctionTimerScore(gameTime, nextCloseAt), value: String(auction.id) },
        ]);

        return { ok: true };
    }),
});
