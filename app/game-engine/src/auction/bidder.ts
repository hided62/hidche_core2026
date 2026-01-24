import { randomUUID } from 'node:crypto';

import { createGamePostgresConnector, GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';

import type { TurnDaemonCommand, TurnDaemonCommandResult, TurnDaemonHooks } from '../lifecycle/types.js';
import type { InMemoryTurnWorld } from '../turn/inMemoryWorld.js';

export interface AuctionBidder {
    bid(command: Extract<TurnDaemonCommand, { type: 'auctionBid' }>): Promise<TurnDaemonCommandResult>;
    close(): Promise<void>;
}

type AuctionType = 'BUY_RICE' | 'SELL_RICE' | 'UNIQUE_ITEM';

type AuctionStatus = 'OPEN' | 'FINALIZING' | 'FINISHED' | 'CANCELED';

const COEFF_EXTENSION_MINUTES_PER_BID = 1 / 6;
const MIN_EXTENSION_MINUTES_PER_BID = 1;

interface AuctionRow {
    id: number;
    type: AuctionType;
    detail: unknown;
    status: AuctionStatus;
    closeAt: Date;
}

interface AuctionBidRow {
    id: number;
    generalId: number;
    amount: number;
}

interface AuctionDetail {
    isReverse?: boolean;
    startBidAmount?: number;
    availableLatestBidCloseDate?: string | null;
}

const buildFlushResult = (world: InMemoryTurnWorld) => {
    const state = world.getState();
    return {
        lastTurnTime: state.lastTurnTime.toISOString(),
        processedGenerals: 0,
        processedTurns: 0,
        durationMs: 0,
        partial: false,
        checkpoint: world.getCheckpoint(),
    };
};

const flushWorld = async (world: InMemoryTurnWorld, hooks?: TurnDaemonHooks): Promise<void> => {
    if (!hooks?.flushChanges) {
        return;
    }
    await hooks.flushChanges(buildFlushResult(world));
};

const parseDetail = (detail: unknown): AuctionDetail => {
    if (!detail || typeof detail !== 'object') {
        return {};
    }
    return detail as AuctionDetail;
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

const loadAuction = async (prisma: GamePrismaClient, auctionId: number): Promise<AuctionRow | null> => {
    const rows = await prisma.$queryRaw<AuctionRow[]>(
        GamePrisma.sql`
            SELECT id,
                type,
                detail,
                status,
                close_at as "closeAt"
            FROM auction
            WHERE id = ${auctionId}
        `
    );
    return rows[0] ?? null;
};

const loadHighestBid = async (
    prisma: GamePrismaClient,
    auctionId: number,
    isReverse: boolean
): Promise<AuctionBidRow | null> => {
    const rows = await prisma.$queryRaw<AuctionBidRow[]>(
        isReverse
            ? GamePrisma.sql`
                SELECT id, general_id as "generalId", amount
                FROM auction_bid
                WHERE auction_id = ${auctionId}
                ORDER BY amount ASC, id ASC
                LIMIT 1
              `
            : GamePrisma.sql`
                SELECT id, general_id as "generalId", amount
                FROM auction_bid
                WHERE auction_id = ${auctionId}
                ORDER BY amount DESC, id ASC
                LIMIT 1
              `
    );
    return rows[0] ?? null;
};

const loadMyPrevBid = async (
    prisma: GamePrismaClient,
    auctionId: number,
    generalId: number,
    isReverse: boolean
): Promise<AuctionBidRow | null> => {
    const rows = await prisma.$queryRaw<AuctionBidRow[]>(
        isReverse
            ? GamePrisma.sql`
                SELECT id, general_id as "generalId", amount
                FROM auction_bid
                WHERE auction_id = ${auctionId} AND general_id = ${generalId}
                ORDER BY amount ASC, id ASC
                LIMIT 1
              `
            : GamePrisma.sql`
                SELECT id, general_id as "generalId", amount
                FROM auction_bid
                WHERE auction_id = ${auctionId} AND general_id = ${generalId}
                ORDER BY amount DESC, id ASC
                LIMIT 1
              `
    );
    return rows[0] ?? null;
};

type QueryClient = Pick<GamePrismaClient, '$queryRaw'>;

const resolveUserId = async (prisma: QueryClient, generalId: number): Promise<string | null> => {
    const rows = await prisma.$queryRaw<{ userId: string | null }[]>(
        GamePrisma.sql`SELECT user_id as "userId" FROM general WHERE id = ${generalId}`
    );
    return rows[0]?.userId ?? null;
};

export const createAuctionBidder = async (options: {
    databaseUrl: string;
    world: InMemoryTurnWorld;
    hooks?: TurnDaemonHooks;
}): Promise<AuctionBidder> => {
    const connector = createGamePostgresConnector({ url: options.databaseUrl });
    await connector.connect();
    const prisma = connector.prisma;
    const world = options.world;
    const hooks = options.hooks;

    return {
        bid: async (command): Promise<TurnDaemonCommandResult> => {
            const auction = await loadAuction(prisma, command.auctionId);
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
            const highestBid = await loadHighestBid(prisma, command.auctionId, isReverse);
            const myPrevBidRaw = await loadMyPrevBid(prisma, command.auctionId, command.generalId, isReverse);
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

            if (auction.type !== 'UNIQUE_ITEM' && highestBid && highestBid.generalId !== command.generalId && !myPrevBid) {
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
            const nextCloseAt = extendCloseDate({
                now,
                closeAt: auction.closeAt,
                turnMinutes,
                availableLatestBidCloseDate,
            });

            const eventId = randomUUID();
            const eventAt = now;

            try {
                await prisma.$transaction(async (tx) => {
                    await tx.$executeRaw(
                        GamePrisma.sql`
                            INSERT INTO auction_bid (auction_id, general_id, amount, event_id, event_at, meta)
                            VALUES (
                                ${command.auctionId},
                                ${command.generalId},
                                ${command.amount},
                                ${eventId},
                                ${eventAt},
                                ${JSON.stringify({ tryExtendCloseDate: command.tryExtendCloseDate ?? true })}::jsonb
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
                        const current = await tx.inheritancePoint.findUnique({
                            where: {
                                userId_key: {
                                    userId,
                                    key: 'previous',
                                },
                            },
                        });
                        const prevValue = current?.value ?? 0;
                        if (prevValue < morePoint) {
                            throw new Error('INSUFFICIENT_POINT');
                        }
                        await tx.inheritancePoint.upsert({
                            where: {
                                userId_key: {
                                    userId,
                                    key: 'previous',
                                },
                            },
                            update: { value: prevValue - morePoint },
                            create: { userId, key: 'previous', value: prevValue - morePoint },
                        });

                        if (highestBid && highestBid.generalId !== command.generalId && !myPrevBid) {
                            const prevUserId = await resolveUserId(tx, highestBid.generalId);
                            if (prevUserId) {
                                const prevPoint = await tx.inheritancePoint.findUnique({
                                    where: {
                                        userId_key: {
                                            userId: prevUserId,
                                            key: 'previous',
                                        },
                                    },
                                });
                                const nextValue = (prevPoint?.value ?? 0) + highestBid.amount;
                                await tx.inheritancePoint.upsert({
                                    where: {
                                        userId_key: {
                                            userId: prevUserId,
                                            key: 'previous',
                                        },
                                    },
                                    update: { value: nextValue },
                                    create: { userId: prevUserId, key: 'previous', value: nextValue },
                                });
                            }
                        }
                    }
                });
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

            if (auction.type !== 'UNIQUE_ITEM') {
                const resourceType = auction.type === 'BUY_RICE' ? 'gold' : 'rice';
                world.updateGeneral(command.generalId, {
                    gold: resourceType === 'gold' ? general.gold - morePoint : general.gold,
                    rice: resourceType === 'rice' ? general.rice - morePoint : general.rice,
                });

                if (highestBid && highestBid.generalId !== command.generalId && !myPrevBid) {
                    const prev = world.getGeneralById(highestBid.generalId);
                    if (prev) {
                        world.updateGeneral(highestBid.generalId, {
                            gold:
                                resourceType === 'gold' ? prev.gold + highestBid.amount : prev.gold,
                            rice:
                                resourceType === 'rice' ? prev.rice + highestBid.amount : prev.rice,
                        });
                    }
                }

                await flushWorld(world, hooks);
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
