import { randomUUID } from 'node:crypto';

import { createGamePostgresConnector, GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';

import type { TurnDaemonCommand, TurnDaemonCommandResult } from '../lifecycle/types.js';
import type { InMemoryTurnWorld } from '../turn/inMemoryWorld.js';

export interface AuctionBidder {
    bid(
        command: Extract<TurnDaemonCommand, { type: 'auctionBid' }>,
        db?: GamePrisma.TransactionClient
    ): Promise<TurnDaemonCommandResult>;
    close(): Promise<void>;
}

type AuctionType = 'BUY_RICE' | 'SELL_RICE' | 'UNIQUE_ITEM';

type AuctionStatus = 'OPEN' | 'FINALIZING' | 'FINISHED' | 'CANCELED';

const COEFF_EXTENSION_MINUTES_PER_BID = 1 / 6;
const MIN_EXTENSION_MINUTES_PER_BID = 1;

interface AuctionRow {
    id: number;
    type: AuctionType;
    hostGeneralId: number;
    detail: unknown;
    status: AuctionStatus;
    closeAt: Date;
}

interface AuctionBidRow {
    id: number;
    generalId: number;
    amount: number;
    meta: unknown;
}

interface AuctionDetail {
    isReverse?: boolean;
    startBidAmount?: number;
    finishBidAmount?: number | null;
    availableLatestBidCloseDate?: string | null;
}

const parseDetail = (detail: unknown): AuctionDetail => {
    if (!detail || typeof detail !== 'object') {
        return {};
    }
    return detail as AuctionDetail;
};

const toFiniteNumber = (value: unknown): number => {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
};

const readRankTrackedAmount = (bid: AuctionBidRow | null): number => {
    if (!bid?.meta || typeof bid.meta !== 'object' || Array.isArray(bid.meta)) return 0;
    return Math.max(0, toFiniteNumber((bid.meta as Record<string, unknown>).inheritSpentTrackedAmount));
};

const extendCloseDate = (options: {
    now: Date;
    closeAt: Date;
    turnMinutes: number;
    availableLatestBidCloseDate?: Date | null;
}): Date => {
    const { now, closeAt, turnMinutes, availableLatestBidCloseDate } = options;
    const extendMinutes = Math.max(MIN_EXTENSION_MINUTES_PER_BID, turnMinutes * COEFF_EXTENSION_MINUTES_PER_BID);
    const extended = new Date(now.getTime() + extendMinutes * 60 * 1000);
    if (extended.getTime() <= closeAt.getTime()) {
        return closeAt;
    }
    if (availableLatestBidCloseDate && extended.getTime() > availableLatestBidCloseDate.getTime()) {
        return availableLatestBidCloseDate;
    }
    return extended;
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

type QueryClient = Pick<GamePrismaClient, '$queryRaw'>;

const loadAuction = async (prisma: QueryClient, auctionId: number): Promise<AuctionRow | null> => {
    const rows = await prisma.$queryRaw<AuctionRow[]>(
        GamePrisma.sql`
            SELECT id,
                type,
                host_general_id as "hostGeneralId",
                detail,
                status,
                close_at as "closeAt"
            FROM auction
            WHERE id = ${auctionId}
            FOR UPDATE
        `
    );
    return rows[0] ?? null;
};

const loadHighestBid = async (
    prisma: QueryClient,
    auctionId: number,
    isReverse: boolean
): Promise<AuctionBidRow | null> => {
    const rows = await prisma.$queryRaw<AuctionBidRow[]>(
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
    );
    return rows[0] ?? null;
};

const loadMyPrevBid = async (
    prisma: QueryClient,
    auctionId: number,
    generalId: number,
    isReverse: boolean
): Promise<AuctionBidRow | null> => {
    const rows = await prisma.$queryRaw<AuctionBidRow[]>(
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
    );
    return rows[0] ?? null;
};

const resolveUserId = async (prisma: QueryClient, generalId: number): Promise<string | null> => {
    const rows = await prisma.$queryRaw<{ userId: string | null }[]>(
        GamePrisma.sql`SELECT user_id as "userId" FROM general WHERE id = ${generalId}`
    );
    return rows[0]?.userId ?? null;
};

export const createAuctionBidder = async (options: {
    databaseUrl: string;
    world: InMemoryTurnWorld;
}): Promise<AuctionBidder> => {
    const connector = createGamePostgresConnector({ url: options.databaseUrl });
    await connector.connect();
    const prisma = connector.prisma;
    const world = options.world;

    return {
        bid: async (command, commandDb): Promise<TurnDaemonCommandResult> => {
            const db = commandDb ?? prisma;
            const auction = await loadAuction(db, command.auctionId);
            if (!auction) {
                return { type: 'auctionBid', ok: false, auctionId: command.auctionId, reason: '경매가 없습니다.' };
            }
            if (auction.status !== 'OPEN') {
                return {
                    type: 'auctionBid',
                    ok: false,
                    auctionId: command.auctionId,
                    reason: '경매가 종료되었습니다.',
                };
            }
            const now = new Date();
            if (auction.closeAt.getTime() <= now.getTime()) {
                return {
                    type: 'auctionBid',
                    ok: false,
                    auctionId: command.auctionId,
                    reason: '경매가 종료되었습니다.',
                };
            }

            const detail = parseDetail(auction.detail);
            const isReverse = detail.isReverse === true;
            const highestBid = await loadHighestBid(db, command.auctionId, isReverse);
            const myPrevBidRaw = await loadMyPrevBid(db, command.auctionId, command.generalId, isReverse);
            const myPrevBid = shouldUsePrevBid(highestBid, myPrevBidRaw);

            if (highestBid) {
                if (!isReverse && command.amount <= highestBid.amount) {
                    return {
                        type: 'auctionBid',
                        ok: false,
                        auctionId: command.auctionId,
                        reason: '현재입찰가보다 높게 입찰해야 합니다.',
                    };
                }
                if (isReverse && command.amount >= highestBid.amount) {
                    return {
                        type: 'auctionBid',
                        ok: false,
                        auctionId: command.auctionId,
                        reason: '현재입찰가보다 낮게 입찰해야 합니다.',
                    };
                }
            } else if (detail.startBidAmount && command.amount < detail.startBidAmount) {
                return {
                    type: 'auctionBid',
                    ok: false,
                    auctionId: command.auctionId,
                    reason: '시작가보다 낮습니다.',
                };
            }
            if (!isReverse && detail.finishBidAmount != null && command.amount > detail.finishBidAmount) {
                return {
                    type: 'auctionBid',
                    ok: false,
                    auctionId: command.auctionId,
                    reason: '즉시판매가보다 높을 수 없습니다.',
                };
            }
            if (isReverse && detail.finishBidAmount != null && command.amount < detail.finishBidAmount) {
                return {
                    type: 'auctionBid',
                    ok: false,
                    auctionId: command.auctionId,
                    reason: '즉시판매가보다 낮을 수 없습니다.',
                };
            }

            if (auction.type === 'UNIQUE_ITEM' && highestBid) {
                if (command.amount < highestBid.amount * 1.01) {
                    return {
                        type: 'auctionBid',
                        ok: false,
                        auctionId: command.auctionId,
                        reason: '현재입찰가보다 1% 높게 입찰해야 합니다.',
                    };
                }
                if (command.amount < highestBid.amount + 10) {
                    return {
                        type: 'auctionBid',
                        ok: false,
                        auctionId: command.auctionId,
                        reason: '현재입찰가보다 10 포인트 높게 입찰해야 합니다.',
                    };
                }
            }

            const morePoint = command.amount - (myPrevBid?.amount ?? 0);
            if (morePoint <= 0) {
                return {
                    type: 'auctionBid',
                    ok: false,
                    auctionId: command.auctionId,
                    reason: '입찰가가 유효하지 않습니다.',
                };
            }

            const general = world.getGeneralById(command.generalId);
            if (!general) {
                return {
                    type: 'auctionBid',
                    ok: false,
                    auctionId: command.auctionId,
                    reason: '장수 정보를 찾을 수 없습니다.',
                };
            }
            if (auction.type !== 'UNIQUE_ITEM' && auction.hostGeneralId === general.id) {
                return {
                    type: 'auctionBid',
                    ok: false,
                    auctionId: command.auctionId,
                    reason: '자신이 연 경매에 입찰할 수 없습니다.',
                };
            }

            if (auction.type === 'BUY_RICE' && general.gold < morePoint) {
                return {
                    type: 'auctionBid',
                    ok: false,
                    auctionId: command.auctionId,
                    reason: '금이 부족합니다.',
                };
            }
            if (auction.type === 'SELL_RICE' && general.rice < morePoint) {
                return {
                    type: 'auctionBid',
                    ok: false,
                    auctionId: command.auctionId,
                    reason: '쌀이 부족합니다.',
                };
            }

            if (
                auction.type !== 'UNIQUE_ITEM' &&
                highestBid &&
                highestBid.generalId !== command.generalId &&
                !myPrevBid
            ) {
                const prev = world.getGeneralById(highestBid.generalId);
                if (!prev) {
                    return {
                        type: 'auctionBid',
                        ok: false,
                        auctionId: command.auctionId,
                        reason: '환불 대상을 찾을 수 없습니다.',
                    };
                }
            }

            const turnMinutes = Math.max(1, Math.round(world.getState().tickSeconds / 60));
            const availableLatestBidCloseDate = detail.availableLatestBidCloseDate
                ? new Date(detail.availableLatestBidCloseDate)
                : null;
            let nextCloseAt = extendCloseDate({
                now,
                closeAt: auction.closeAt,
                turnMinutes,
                availableLatestBidCloseDate,
            });
            if (
                auction.type !== 'UNIQUE_ITEM' &&
                detail.finishBidAmount != null &&
                command.amount === detail.finishBidAmount
            ) {
                nextCloseAt = new Date(now.getTime() + turnMinutes * 60_000);
            }

            const eventId = randomUUID();
            const eventAt = now;
            const rankTrackedAmount = auction.type === 'UNIQUE_ITEM' ? readRankTrackedAmount(myPrevBid) + morePoint : 0;
            const previousRankTrackedAmount = readRankTrackedAmount(highestBid);

            try {
                const persistBid = async (tx: GamePrisma.TransactionClient): Promise<void> => {
                    await tx.$executeRaw(
                        GamePrisma.sql`
                            INSERT INTO auction_bid (auction_id, general_id, amount, event_id, event_at, meta)
                            VALUES (
                                ${command.auctionId},
                                ${command.generalId},
                                ${command.amount},
                                ${eventId},
                                ${eventAt},
                                ${JSON.stringify({
                                    tryExtendCloseDate: command.tryExtendCloseDate ?? true,
                                    ...(auction.type === 'UNIQUE_ITEM'
                                        ? { inheritSpentTrackedAmount: rankTrackedAmount }
                                        : {}),
                                })}::jsonb
                            )
                        `
                    );

                    const updated = await tx.$executeRaw(
                        GamePrisma.sql`
                            UPDATE auction
                            SET close_at = ${nextCloseAt},
                                latest_event_id = ${eventId},
                                latest_event_at = ${eventAt},
                                updated_at = ${eventAt}
                            WHERE id = ${command.auctionId}
                              AND status = 'OPEN'
                              AND (
                                latest_event_at < ${eventAt}
                                OR (latest_event_at = ${eventAt} AND latest_event_id < ${eventId})
                              )
                        `
                    );

                    if (updated === 0) {
                        throw new Error('CONFLICT');
                    }

                    if (auction.type === 'UNIQUE_ITEM') {
                        const userId = await resolveUserId(tx, command.generalId);
                        if (!userId) {
                            throw new Error('USER_NOT_FOUND');
                        }
                        const deductedRows = await tx.$queryRaw<Array<{ value: number }>>(
                            GamePrisma.sql`
                                UPDATE inheritance_point
                                SET value = value - ${morePoint},
                                    updated_at = ${eventAt}
                                WHERE user_id = ${userId}
                                  AND key = 'previous'
                                  AND value >= ${morePoint}
                                RETURNING value
                            `
                        );
                        if (deductedRows.length === 0) {
                            throw new Error('INSUFFICIENT_POINT');
                        }
                        await tx.$executeRaw(
                            GamePrisma.sql`
                                INSERT INTO rank_data (nation_id, general_id, type, value)
                                SELECT nation_id, id, 'inherit_spent_dyn', ${morePoint}
                                FROM general
                                WHERE id = ${command.generalId}
                                ON CONFLICT (general_id, type)
                                DO UPDATE SET
                                    nation_id = EXCLUDED.nation_id,
                                    value = rank_data.value + EXCLUDED.value
                            `
                        );

                        if (highestBid && highestBid.generalId !== command.generalId && !myPrevBid) {
                            const prevUserId = await resolveUserId(tx, highestBid.generalId);
                            if (!prevUserId) {
                                throw new Error('USER_NOT_FOUND');
                            }
                            await tx.$executeRaw(
                                GamePrisma.sql`
                                    INSERT INTO inheritance_point (user_id, key, value, updated_at)
                                    VALUES (${prevUserId}, 'previous', ${highestBid.amount}, ${eventAt})
                                    ON CONFLICT (user_id, key)
                                    DO UPDATE SET
                                        value = inheritance_point.value + EXCLUDED.value,
                                        updated_at = EXCLUDED.updated_at
                                `
                            );
                            await tx.$executeRaw(
                                GamePrisma.sql`
                                    UPDATE rank_data
                                    SET value = GREATEST(0, value - ${previousRankTrackedAmount})
                                    WHERE general_id = ${highestBid.generalId}
                                      AND type = 'inherit_spent_dyn'
                                `
                            );
                        }
                    }
                };
                if (commandDb) {
                    await commandDb.$executeRawUnsafe('SAVEPOINT auction_bid_attempt');
                    try {
                        await persistBid(commandDb);
                        await commandDb.$executeRawUnsafe('RELEASE SAVEPOINT auction_bid_attempt');
                    } catch (error) {
                        await commandDb.$executeRawUnsafe('ROLLBACK TO SAVEPOINT auction_bid_attempt');
                        await commandDb.$executeRawUnsafe('RELEASE SAVEPOINT auction_bid_attempt');
                        throw error;
                    }
                } else {
                    await prisma.$transaction(persistBid);
                }
            } catch (error) {
                const reason = error instanceof Error ? error.message : 'CONFLICT';
                if (reason === 'INSUFFICIENT_POINT') {
                    return {
                        type: 'auctionBid',
                        ok: false,
                        auctionId: command.auctionId,
                        reason: '유산포인트가 부족합니다.',
                    };
                }
                if (reason === 'USER_NOT_FOUND') {
                    return {
                        type: 'auctionBid',
                        ok: false,
                        auctionId: command.auctionId,
                        reason: '장수 정보를 찾을 수 없습니다.',
                    };
                }
                return {
                    type: 'auctionBid',
                    ok: false,
                    auctionId: command.auctionId,
                    reason: '경매가 취소되었습니다.',
                };
            }

            if (auction.type === 'UNIQUE_ITEM') {
                world.updateGeneral(command.generalId, {
                    inheritancePoints: {
                        ...general.inheritancePoints,
                        previous: toFiniteNumber(general.inheritancePoints?.previous) - morePoint,
                    },
                    meta: {
                        ...general.meta,
                        inherit_spent_dyn: toFiniteNumber(general.meta.inherit_spent_dyn) + morePoint,
                    },
                });
                if (highestBid && highestBid.generalId !== command.generalId && !myPrevBid) {
                    const prev = world.getGeneralById(highestBid.generalId);
                    if (prev) {
                        world.updateGeneral(prev.id, {
                            inheritancePoints: {
                                ...prev.inheritancePoints,
                                previous: toFiniteNumber(prev.inheritancePoints?.previous) + highestBid.amount,
                            },
                            meta: {
                                ...prev.meta,
                                inherit_spent_dyn: Math.max(
                                    0,
                                    toFiniteNumber(prev.meta.inherit_spent_dyn) - previousRankTrackedAmount
                                ),
                            },
                        });
                    }
                }
            } else {
                const resourceType = auction.type === 'BUY_RICE' ? 'gold' : 'rice';
                world.updateGeneral(command.generalId, {
                    gold: resourceType === 'gold' ? general.gold - morePoint : general.gold,
                    rice: resourceType === 'rice' ? general.rice - morePoint : general.rice,
                });

                if (highestBid && highestBid.generalId !== command.generalId && !myPrevBid) {
                    const prev = world.getGeneralById(highestBid.generalId);
                    if (prev) {
                        world.updateGeneral(highestBid.generalId, {
                            gold: resourceType === 'gold' ? prev.gold + highestBid.amount : prev.gold,
                            rice: resourceType === 'rice' ? prev.rice + highestBid.amount : prev.rice,
                        });
                    }
                }
            }

            return {
                type: 'auctionBid',
                ok: true,
                auctionId: command.auctionId,
                closeAt: nextCloseAt.toISOString(),
            };
        },
        close: async (): Promise<void> => {
            await connector.disconnect();
        },
    };
};
