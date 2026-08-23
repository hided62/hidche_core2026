import { createGamePostgresConnector, GamePrisma } from '@sammo-ts/infra';
import { ActionLogger, ItemLoader, LogFormat, isItemKey, type MessageDraft } from '@sammo-ts/logic';
import { resolveLegacyCompatibleUniqueConfig } from '@sammo-ts/logic/rewards/legacyUniqueItemPool.js';
import { cloneItemInventory, ensureItemInventory, equipNewItem } from '@sammo-ts/logic/items/index.js';
import { asRecord, JosaUtil } from '@sammo-ts/common';

import type { TurnDaemonCommand, TurnDaemonCommandResult } from '../lifecycle/types.js';
import type { InMemoryTurnWorld } from '../turn/inMemoryWorld.js';
import type { TurnGeneral } from '../turn/types.js';
import type { LogEntryDraft } from '@sammo-ts/logic';

export interface AuctionFinalizer {
    finalize(
        command: Extract<TurnDaemonCommand, { type: 'auctionFinalize' }>,
        db?: GamePrisma.TransactionClient
    ): Promise<TurnDaemonCommandResult>;
    close(): Promise<void>;
}

type AuctionType = 'BUY_RICE' | 'SELL_RICE' | 'UNIQUE_ITEM';
type AuctionStatus = 'OPEN' | 'FINALIZING' | 'FINISHED' | 'CANCELED';

const COEFF_EXTENSION_MINUTES_PER_BID = 1 / 6;
const MIN_EXTENSION_MINUTES_PER_BID = 1;
const MIN_EXTENSION_MINUTES_LIMIT_BY_BID = 5;
const COEFF_EXTENSION_MINUTES_LIMIT_UNIQUE_COUNT = 24;
const MIN_EXTENSION_MINUTES_BY_EXTENSION_QUERY = 5;

interface AuctionRow {
    id: number;
    type: AuctionType;
    targetCode: string | null;
    hostGeneralId: number;
    hostName: string | null;
    detail: unknown;
    status: AuctionStatus;
    closeAt: Date;
    closeTick: bigint | null;
}

interface AuctionBidRow {
    id: number;
    generalId: number;
    amount: number;
    meta: unknown;
}

interface AuctionDetailBase {
    title?: string;
    isReverse?: boolean;
    tryExtendCloseDate?: boolean;
    availableLatestBidCloseDate?: string | null;
    remainCloseDateExtensionCnt?: number | null;
}

interface AuctionDetailResource extends AuctionDetailBase {
    amount?: number;
}

const parseDetail = (detail: unknown): AuctionDetailResource => {
    if (!detail || typeof detail !== 'object') {
        return {};
    }
    return detail as AuctionDetailResource;
};

const toFiniteNumber = (value: unknown): number => {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
};

const readRankTrackedAmount = (bid: AuctionBidRow): number => {
    const meta = asRecord(bid.meta);
    return Math.max(0, toFiniteNumber(meta.inheritSpentTrackedAmount));
};

export const resolveAuctionResourceAmount = (detailAmount: unknown, targetCode: string | null): number | null => {
    const detailValue = toFiniteNumber(detailAmount);
    if (detailValue > 0) return detailValue;
    const targetValue = toFiniteNumber(targetCode);
    return targetValue > 0 ? targetValue : null;
};

export const isUniqueAuctionSupplyExhausted = (configuredAmount: number, occupiedAmount: number): boolean =>
    configuredAmount <= occupiedAmount;

export const resolveUniqueSupplyRetryCloseAt = (now: Date, turnMinutes: number): Date =>
    new Date(now.getTime() + Math.max(1, turnMinutes) * 60_000);

export const isAuctionFinalizeGenerationCurrent = (
    auction: Pick<AuctionRow, 'closeAt' | 'closeTick'>,
    command: Pick<Extract<TurnDaemonCommand, { type: 'auctionFinalize' }>, 'expectedCloseAt' | 'expectedCloseTick'>
): boolean => {
    if (command.expectedCloseTick !== undefined) {
        return auction.closeTick !== null && auction.closeTick === BigInt(command.expectedCloseTick);
    }
    if (command.expectedCloseAt !== undefined) {
        return auction.closeAt.getTime() === new Date(command.expectedCloseAt).getTime();
    }
    return true;
};

export const hasAuctionFinalizeDeadlineArrived = (
    auction: Pick<AuctionRow, 'closeAt' | 'closeTick'>,
    now: Date,
    nowTick: number
): boolean =>
    auction.closeTick === null ? auction.closeAt.getTime() <= now.getTime() : auction.closeTick <= BigInt(nowTick);

export const buildAuctionBidderSystemMessage = (options: {
    bidder: TurnGeneral;
    nation?: { name: string; color: string } | null;
    time: Date;
    text: string;
}): MessageDraft => ({
    msgType: 'private',
    src: {
        generalId: 0,
        generalName: '',
        nationId: 0,
        nationName: 'System',
        color: '#000000',
        icon: '',
    },
    dest: {
        generalId: options.bidder.id,
        generalName: options.bidder.name,
        nationId: options.bidder.nationId,
        nationName: options.nation?.name ?? '재야',
        color: options.nation?.color ?? '#000000',
        icon: options.bidder.picture ?? '',
    },
    text: options.text,
    time: new Date(options.time.getTime()),
    validUntil: new Date('9999-12-31T00:00:00.000Z'),
    option: {},
    sendDestOnly: true,
});

export const buildAuctionCancellationMessage = (options: {
    auctionId: number;
    title?: string;
    bidder: TurnGeneral;
    nation?: { name: string; color: string } | null;
    time: Date;
}): MessageDraft =>
    buildAuctionBidderSystemMessage({
        bidder: options.bidder,
        nation: options.nation,
        time: options.time,
        text: `${options.auctionId}번 ${options.title ?? '경매'}가 취소되었습니다.`,
    });

const toTurnMinutes = (tickSeconds: number): number => Math.max(1, Math.round(tickSeconds / 60));

type AuctionDb = GamePrisma.TransactionClient;

const resolveTurnMinutes = async (prisma: AuctionDb): Promise<number> => {
    const rows = (await prisma.$queryRaw(
        GamePrisma.sql`SELECT tick_seconds as "tickSeconds" FROM world_state ORDER BY id LIMIT 1`
    )) as Array<{ tickSeconds: number }>;
    return toTurnMinutes(rows[0]?.tickSeconds ?? 60);
};

const pushLogs = (world: InMemoryTurnWorld, logs: LogEntryDraft[]): void => {
    for (const log of logs) {
        world.pushLog(log);
    }
};

export const buildUniqueAuctionInheritanceLogData = (options: {
    userId: string;
    year: number;
    month: number;
    itemName: string;
    amount: number;
}) => ({
    userId: options.userId,
    year: options.year,
    month: options.month,
    logType: 'inheritPoint',
    text: `유니크 ${options.itemName} 경매로 ${options.amount} 포인트 사용`,
});

export const buildUniqueAuctionAwardLogs = (options: {
    bidder: TurnGeneral;
    nationName: string;
    itemName: string;
    itemRawName: string;
}): LogEntryDraft[] => {
    const logger = new ActionLogger({ generalId: options.bidder.id, nationId: options.bidder.nationId });
    const josaYi = JosaUtil.pick(options.bidder.name, '이');
    const josaUl = JosaUtil.pick(options.itemRawName, '을');
    logger.pushGeneralActionLog(`<C>${options.itemName}</>${josaUl} 습득했습니다!`);
    logger.pushGeneralHistoryLog(`<C>${options.itemName}</>${josaUl} 습득`);
    logger.pushGlobalActionLog(
        `<Y>${options.bidder.name}</>${josaYi} <C>${options.itemName}</>${josaUl} 습득했습니다!`
    );
    logger.pushGlobalHistoryLog(
        `<C><b>【보물수배】</b></><D><b>${options.nationName}</b></>의 <Y>${options.bidder.name}</>${josaYi} <C>${options.itemName}</>${josaUl} 습득했습니다!`
    );
    return logger.flush();
};

const refundInheritancePoint = async (options: {
    prisma: AuctionDb;
    userId: string;
    generalId: number;
    amount: number;
    rankTrackedAmount: number;
}): Promise<void> => {
    const { prisma, userId, generalId, amount, rankTrackedAmount } = options;
    if (!userId || amount <= 0) {
        return;
    }
    await prisma.$executeRaw(
        GamePrisma.sql`
            INSERT INTO inheritance_point (user_id, key, value, updated_at)
            VALUES (${userId}, 'previous', ${amount}, ${new Date()})
            ON CONFLICT (user_id, key)
            DO UPDATE SET
                value = inheritance_point.value + EXCLUDED.value,
                updated_at = EXCLUDED.updated_at
        `
    );
    if (rankTrackedAmount > 0) {
        await prisma.$executeRaw(
            GamePrisma.sql`
                UPDATE rank_data
                SET value = GREATEST(0, value - ${rankTrackedAmount})
                WHERE general_id = ${generalId}
                  AND type = 'inherit_spent_dyn'
            `
        );
    }
};

export const createAuctionFinalizer = async (options: {
    databaseUrl: string;
    world: InMemoryTurnWorld;
}): Promise<AuctionFinalizer> => {
    const connector = createGamePostgresConnector({ url: options.databaseUrl });
    await connector.connect();
    const world = options.world;
    const itemLoader = new ItemLoader();

    const getGeneralUserId = async (db: AuctionDb, generalId: number): Promise<string | null> => {
        const rows = await db.$queryRaw<{ userId: string | null }[]>(
            GamePrisma.sql`SELECT user_id as "userId" FROM general WHERE id = ${generalId}`
        );
        return rows[0]?.userId ?? null;
    };

    return {
        finalize: async (command, commandDb): Promise<TurnDaemonCommandResult> => {
            const auctionId = command.auctionId;
            if (!commandDb) {
                return {
                    type: 'auctionFinalize',
                    ok: false,
                    auctionId,
                    reason: '경매 확정은 ENGINE mutation transaction에서만 실행할 수 있습니다.',
                };
            }
            const db = commandDb;
            const rows = await db.$queryRaw<AuctionRow[]>(
                GamePrisma.sql`
                    SELECT id,
                        type,
                        target_code as "targetCode",
                        host_general_id as "hostGeneralId",
                        host_name as "hostName",
                        detail,
                        status,
                        close_at as "closeAt",
                        close_tick as "closeTick"
                    FROM auction
                    WHERE id = ${auctionId}
                    FOR UPDATE
                `
            );
            const auction = rows[0];
            if (!auction) {
                return {
                    type: 'auctionFinalize',
                    ok: false,
                    auctionId,
                    reason: '경매 정보를 찾을 수 없습니다.',
                };
            }

            if (auction.status === 'FINISHED' || auction.status === 'CANCELED') {
                return { type: 'auctionFinalize', ok: true, auctionId };
            }

            const now = world.getGameNow(new Date());
            if (auction.status === 'OPEN') {
                if (!isAuctionFinalizeGenerationCurrent(auction, command)) {
                    return {
                        type: 'auctionFinalize',
                        ok: false,
                        auctionId,
                        reason: '경매 마감 세대가 변경되었습니다.',
                    };
                }
                const nowTick = world.dateToGameTick(now);
                if (!hasAuctionFinalizeDeadlineArrived(auction, now, nowTick)) {
                    return {
                        type: 'auctionFinalize',
                        ok: false,
                        auctionId,
                        reason: '경매 마감 시각이 아직 지나지 않았습니다.',
                    };
                }
                const transitioned = await db.$executeRaw(
                    GamePrisma.sql`
                        UPDATE auction
                        SET status = 'FINALIZING',
                            finalizing_at = ${now},
                            updated_at = ${now}
                        WHERE id = ${auctionId}
                          AND status = 'OPEN'
                    `
                );
                if (transitioned !== 1) {
                    throw new Error(`경매 확정 상태 전이에 실패했습니다: ${auctionId}`);
                }
            } else if (auction.status !== 'FINALIZING') {
                return {
                    type: 'auctionFinalize',
                    ok: false,
                    auctionId,
                    reason: '경매가 확정 대기 상태가 아닙니다.',
                };
            }

            const detail = parseDetail(auction.detail);
            const isReverse = detail.isReverse === true;

            const bidRows = await db.$queryRaw<AuctionBidRow[]>(
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
            const highestBid = bidRows[0] ?? null;

            const logs: LogEntryDraft[] = [];
            const globalLogger = new ActionLogger();

            const finalizeStatus = async (status: AuctionStatus) => {
                await db.$executeRaw(
                    GamePrisma.sql`
                        UPDATE auction
                        SET status = ${status},
                            finished_at = ${now},
                            updated_at = ${now}
                        WHERE id = ${auctionId}
                    `
                );
            };

            const cancelWithEscrowRefund = async (options: {
                bid: AuctionBidRow;
                resourceAmount?: number | null;
                refundResourceHost?: boolean;
            }): Promise<boolean> => {
                const refundBidder = world.getGeneralById(options.bid.generalId);
                if (!refundBidder) return false;

                const shouldRefundHost =
                    auction.type !== 'UNIQUE_ITEM' && options.refundResourceHost !== false && auction.hostGeneralId > 0;
                const resourceAmount = options.resourceAmount ?? null;
                const resourceHost = shouldRefundHost ? world.getGeneralById(auction.hostGeneralId) : null;
                if (shouldRefundHost && (!resourceHost || resourceAmount === null || resourceAmount <= 0)) {
                    return false;
                }

                if (auction.type === 'UNIQUE_ITEM') {
                    const bidderUserId = await getGeneralUserId(db, refundBidder.id);
                    if (!bidderUserId) return false;
                    const rankTrackedAmount = readRankTrackedAmount(options.bid);
                    await refundInheritancePoint({
                        prisma: db,
                        userId: bidderUserId,
                        generalId: refundBidder.id,
                        amount: options.bid.amount,
                        rankTrackedAmount,
                    });
                    world.updateGeneral(refundBidder.id, {
                        inheritancePoints: {
                            ...refundBidder.inheritancePoints,
                            previous: toFiniteNumber(refundBidder.inheritancePoints?.previous) + options.bid.amount,
                        },
                        meta: {
                            ...refundBidder.meta,
                            inherit_spent_dyn: Math.max(
                                0,
                                toFiniteNumber(refundBidder.meta.inherit_spent_dyn) - rankTrackedAmount
                            ),
                        },
                    });
                } else {
                    const bidderResource = auction.type === 'BUY_RICE' ? 'gold' : 'rice';
                    world.updateGeneral(refundBidder.id, {
                        [bidderResource]: refundBidder[bidderResource] + options.bid.amount,
                    });
                    if (resourceHost && resourceAmount !== null) {
                        const hostResource = auction.type === 'BUY_RICE' ? 'rice' : 'gold';
                        world.updateGeneral(resourceHost.id, {
                            [hostResource]: resourceHost[hostResource] + resourceAmount,
                        });
                    }
                }

                world.queueMessage(
                    buildAuctionCancellationMessage({
                        auctionId: auction.id,
                        title: detail.title,
                        bidder: refundBidder,
                        nation: world.getNationById(refundBidder.nationId),
                        time: now,
                    })
                );
                await finalizeStatus('CANCELED');
                return true;
            };

            if (!highestBid) {
                if (auction.type === 'BUY_RICE' || auction.type === 'SELL_RICE') {
                    const amount = resolveAuctionResourceAmount(detail.amount, auction.targetCode);
                    if (amount === null) {
                        return {
                            type: 'auctionFinalize',
                            ok: false,
                            auctionId,
                            reason: '경매 거래량 정보가 없습니다.',
                        };
                    }
                    if (auction.hostGeneralId > 0) {
                        const host = world.getGeneralById(auction.hostGeneralId);
                        if (!host) {
                            return {
                                type: 'auctionFinalize',
                                ok: false,
                                auctionId,
                                reason: '경매 주최자를 찾을 수 없습니다.',
                            };
                        }
                        const resourceKey = auction.type === 'BUY_RICE' ? 'rice' : 'gold';
                        world.updateGeneral(host.id, {
                            [resourceKey]: host[resourceKey] + amount,
                        });
                        const hostLogger = new ActionLogger({ generalId: host.id, nationId: host.nationId });
                        hostLogger.pushGeneralActionLog(
                            `경매가 유찰되어 ${resourceKey === 'rice' ? '쌀' : '금'} ${amount}을 회수했습니다.`,
                            LogFormat.PLAIN
                        );
                        logs.push(...hostLogger.flush());
                        globalLogger.pushGlobalActionLog(`경매 ${auctionId}번이 유찰되었습니다.`, LogFormat.PLAIN);
                        world.queueMessage(
                            buildAuctionBidderSystemMessage({
                                bidder: host,
                                nation: world.getNationById(host.nationId),
                                time: now,
                                text: `${auctionId}번 ${resourceKey === 'rice' ? '쌀' : '금'} 경매에 입찰이 없어 취소되었습니다.`,
                            })
                        );
                    }
                } else {
                    return {
                        type: 'auctionFinalize',
                        ok: false,
                        auctionId,
                        reason: '유니크 경매 입찰 정보가 없어 자동 환불할 수 없습니다.',
                    };
                }

                logs.push(...globalLogger.flush());
                pushLogs(world, logs);
                await finalizeStatus('FINISHED');
                return { type: 'auctionFinalize', ok: true, auctionId };
            }

            if (auction.type === 'UNIQUE_ITEM') {
                const bidMeta = parseDetail(highestBid.meta);
                const remainExtension = detail.remainCloseDateExtensionCnt ?? 0;
                if (bidMeta.tryExtendCloseDate === true && remainExtension > 0) {
                    const turnMinutes = await resolveTurnMinutes(db);
                    const nextCloseAt = new Date(auction.closeAt.getTime() + Math.max(5, turnMinutes) * 60_000);
                    const nextLatestBidCloseAt = new Date(
                        nextCloseAt.getTime() +
                            Math.max(MIN_EXTENSION_MINUTES_PER_BID, turnMinutes * COEFF_EXTENSION_MINUTES_PER_BID) *
                                60_000
                    );
                    const nextDetail = {
                        ...detail,
                        remainCloseDateExtensionCnt: remainExtension - 1,
                        availableLatestBidCloseDate: nextLatestBidCloseAt.toISOString(),
                    };
                    await db.$executeRaw(
                        GamePrisma.sql`
                            UPDATE auction
                            SET status = 'OPEN',
                                finalizing_at = NULL,
                                detail = ${JSON.stringify(nextDetail)}::jsonb,
                                close_at = ${nextCloseAt},
                                close_tick = ${BigInt(world.dateToGameTick(nextCloseAt))},
                                updated_at = ${now}
                            WHERE id = ${auctionId}
                        `
                    );
                    return {
                        type: 'auctionFinalize',
                        ok: false,
                        auctionId,
                        reason: '입찰자의 요청으로 경매 종료가 연장되었습니다.',
                    };
                }
            }

            const bidder = world.getGeneralById(highestBid.generalId);
            if (!bidder) {
                return {
                    type: 'auctionFinalize',
                    ok: false,
                    auctionId,
                    reason: '입찰자를 찾을 수 없습니다.',
                };
            }

            if (auction.type === 'BUY_RICE' || auction.type === 'SELL_RICE') {
                const amount = resolveAuctionResourceAmount(detail.amount, auction.targetCode);
                if (amount === null) {
                    return {
                        type: 'auctionFinalize',
                        ok: false,
                        auctionId,
                        reason: '경매 거래량 정보가 없습니다.',
                    };
                }
                const hostResource = auction.type === 'BUY_RICE' ? 'rice' : 'gold';
                const bidderResource = auction.type === 'BUY_RICE' ? 'gold' : 'rice';
                if (auction.hostGeneralId > 0) {
                    const host = world.getGeneralById(auction.hostGeneralId);
                    if (!host) {
                        await cancelWithEscrowRefund({
                            bid: highestBid,
                            resourceAmount: amount,
                            refundResourceHost: false,
                        });
                        return {
                            type: 'auctionFinalize',
                            ok: false,
                            auctionId,
                            reason: '경매 주최자를 찾을 수 없습니다.',
                        };
                    }
                    world.updateGeneral(host.id, {
                        [bidderResource]: host[bidderResource] + highestBid.amount,
                    });
                    const hostLogger = new ActionLogger({ generalId: host.id, nationId: host.nationId });
                    const hostJosa = JosaUtil.pick(host.name, '이');
                    hostLogger.pushGeneralActionLog(
                        `${auctionId}번 경매 성사: ${host.name}${hostJosa} ${hostResource === 'rice' ? '쌀' : '금'} ${amount}을 판매했습니다.`,
                        LogFormat.PLAIN
                    );
                    logs.push(...hostLogger.flush());
                }

                world.updateGeneral(bidder.id, {
                    [hostResource]: bidder[hostResource] + amount,
                });
                const bidderLogger = new ActionLogger({ generalId: bidder.id, nationId: bidder.nationId });
                bidderLogger.pushGeneralActionLog(
                    `${auctionId}번 경매 성사: ${hostResource === 'rice' ? '쌀' : '금'} ${amount}을 획득했습니다.`,
                    LogFormat.PLAIN
                );
                logs.push(...bidderLogger.flush());

                globalLogger.pushGlobalActionLog(`경매 ${auctionId}번 거래가 성사되었습니다.`, LogFormat.PLAIN);
            } else if (auction.type === 'UNIQUE_ITEM') {
                const itemKey = auction.targetCode;
                if (!itemKey) {
                    await cancelWithEscrowRefund({ bid: highestBid });
                    return {
                        type: 'auctionFinalize',
                        ok: false,
                        auctionId,
                        reason: '유니크 아이템 정보가 없습니다.',
                    };
                }
                if (!isItemKey(itemKey)) {
                    await cancelWithEscrowRefund({ bid: highestBid });
                    return {
                        type: 'auctionFinalize',
                        ok: false,
                        auctionId,
                        reason: '아이템 키가 올바르지 않습니다.',
                    };
                }
                const itemModule = await itemLoader.load(itemKey).catch(() => null);
                if (!itemModule) {
                    await cancelWithEscrowRefund({ bid: highestBid });
                    return {
                        type: 'auctionFinalize',
                        ok: false,
                        auctionId,
                        reason: '아이템 정보를 불러올 수 없습니다.',
                    };
                }

                const state = world.getState();
                const config = await resolveLegacyCompatibleUniqueConfig(
                    asRecord(world.getScenarioConfig().const),
                    itemLoader
                );
                const configuredAmount = config.allItems[itemModule.slot]?.[itemKey] ?? 0;
                const occupiedAmount = world
                    .listGenerals()
                    .filter((candidate) => candidate.role.items[itemModule.slot] === itemKey).length;
                if (isUniqueAuctionSupplyExhausted(configuredAmount, occupiedAmount)) {
                    // Ref keeps the already-escrowed highest bid and retries the expired
                    // auction on later turn passes when every configured copy is held.
                    // This differs from same-slot ownership, which extends the deadline.
                    const turnMinutes = await resolveTurnMinutes(db);
                    const nextCloseAt = resolveUniqueSupplyRetryCloseAt(now, turnMinutes);
                    await db.$executeRaw(
                        GamePrisma.sql`
                            UPDATE auction
                            SET status = 'OPEN',
                                finalizing_at = NULL,
                                close_at = ${nextCloseAt},
                                close_tick = ${BigInt(world.dateToGameTick(nextCloseAt))},
                                updated_at = ${now}
                            WHERE id = ${auctionId}
                        `
                    );
                    world.queueMessage(
                        buildAuctionBidderSystemMessage({
                            bidder,
                            nation: world.getNationById(bidder.nationId),
                            time: now,
                            text: '그 유니크는 모두 점유되었습니다.',
                        })
                    );
                    return {
                        type: 'auctionFinalize',
                        ok: false,
                        auctionId,
                        reason: '그 유니크는 모두 점유되었습니다.',
                    };
                }
                const scenarioMeta = asRecord(state.meta.scenarioMeta);
                const startYear =
                    typeof scenarioMeta.startYear === 'number' && Number.isFinite(scenarioMeta.startYear)
                        ? scenarioMeta.startYear
                        : state.currentYear;
                const relativeYear = state.currentYear - startYear;
                let uniqueLimit = 1;
                for (const [targetYear, targetLimit] of config.maxUniqueItemLimit) {
                    if (relativeYear < targetYear) {
                        break;
                    }
                    uniqueLimit = targetLimit;
                }
                uniqueLimit = Math.min(uniqueLimit, Object.keys(config.allItems).length);
                let equippedUniqueCount = 0;
                for (const equippedKey of Object.values(bidder.role.items)) {
                    if (!equippedKey || equippedKey === 'None' || !isItemKey(equippedKey)) {
                        continue;
                    }
                    const equippedModule = await itemLoader.load(equippedKey).catch(() => null);
                    if (equippedModule && !equippedModule.buyable) {
                        equippedUniqueCount += 1;
                    }
                }
                if (equippedUniqueCount >= uniqueLimit) {
                    const turnMinutes = await resolveTurnMinutes(db);
                    const nextCloseAt = new Date(
                        auction.closeAt.getTime() +
                            Math.max(
                                MIN_EXTENSION_MINUTES_BY_EXTENSION_QUERY,
                                turnMinutes * COEFF_EXTENSION_MINUTES_LIMIT_UNIQUE_COUNT
                            ) *
                                60_000
                    );
                    const nextLatestBidCloseAt = new Date(
                        nextCloseAt.getTime() +
                            Math.max(MIN_EXTENSION_MINUTES_PER_BID, turnMinutes * COEFF_EXTENSION_MINUTES_PER_BID) *
                                60_000
                    );
                    const nextDetail = {
                        ...detail,
                        availableLatestBidCloseDate: nextLatestBidCloseAt.toISOString(),
                    };
                    await db.$executeRaw(
                        GamePrisma.sql`
                            UPDATE auction
                            SET status = 'OPEN',
                                finalizing_at = NULL,
                                host_general_id = ${bidder.id === auction.hostGeneralId ? auction.hostGeneralId : 0},
                                host_name = ${bidder.id === auction.hostGeneralId ? auction.hostName : '(상인)'},
                                detail = ${JSON.stringify(nextDetail)}::jsonb,
                                close_at = ${nextCloseAt},
                                close_tick = ${BigInt(world.dateToGameTick(nextCloseAt))},
                                updated_at = ${now}
                            WHERE id = ${auctionId}
                        `
                    );
                    globalLogger.pushGlobalActionLog(
                        `유니크 경매 ${auctionId}번이 전체 보유 제한으로 연장되었습니다.`,
                        LogFormat.PLAIN
                    );
                    logs.push(...globalLogger.flush());
                    pushLogs(world, logs);
                    world.queueMessage(
                        buildAuctionBidderSystemMessage({
                            bidder,
                            nation: world.getNationById(bidder.nationId),
                            time: now,
                            text: '유니크 아이템 소유 제한 상태입니다. 종료 시간이 연장됩니다.',
                        })
                    );
                    return {
                        type: 'auctionFinalize',
                        ok: false,
                        auctionId,
                        reason: '유니크 아이템 소유 제한 상태입니다. 종료 시간이 연장됩니다.',
                    };
                }

                const slot = itemModule.slot;
                const currentItem = bidder.role.items?.[slot] ?? null;
                if (currentItem && currentItem !== 'None' && isItemKey(currentItem)) {
                    const currentModule = await itemLoader.load(currentItem).catch(() => null);
                    if (currentModule && !currentModule.buyable) {
                        const turnMinutes = await resolveTurnMinutes(db);
                        const nextCloseAt = new Date(
                            auction.closeAt.getTime() +
                                Math.max(MIN_EXTENSION_MINUTES_LIMIT_BY_BID, turnMinutes * 0.5) * 60_000
                        );
                        const nextLatestBidCloseAt = new Date(
                            nextCloseAt.getTime() +
                                Math.max(MIN_EXTENSION_MINUTES_PER_BID, turnMinutes * COEFF_EXTENSION_MINUTES_PER_BID) *
                                    60_000
                        );
                        const nextDetail = {
                            ...detail,
                            availableLatestBidCloseDate: nextLatestBidCloseAt.toISOString(),
                        };
                        await db.$executeRaw(
                            GamePrisma.sql`
                                UPDATE auction
                                SET status = 'OPEN',
                                    finalizing_at = NULL,
                                    host_general_id = ${bidder.id === auction.hostGeneralId ? auction.hostGeneralId : 0},
                                    host_name = ${bidder.id === auction.hostGeneralId ? auction.hostName : '(상인)'},
                                    detail = ${JSON.stringify(nextDetail)}::jsonb,
                                    close_at = ${nextCloseAt},
                                    close_tick = ${BigInt(world.dateToGameTick(nextCloseAt))},
                                    updated_at = ${now}
                                WHERE id = ${auctionId}
                            `
                        );
                        globalLogger.pushGlobalActionLog(
                            `유니크 경매 ${auctionId}번이 보유 제한으로 연장되었습니다.`,
                            LogFormat.PLAIN
                        );
                        logs.push(...globalLogger.flush());
                        pushLogs(world, logs);
                        world.queueMessage(
                            buildAuctionBidderSystemMessage({
                                bidder,
                                nation: world.getNationById(bidder.nationId),
                                time: now,
                                text:
                                    currentItem === itemKey
                                        ? '이미 그 유니크를 가지고 있습니다.'
                                        : '이미 다른 유니크를 가지고 있습니다.',
                            })
                        );
                        return {
                            type: 'auctionFinalize',
                            ok: false,
                            auctionId,
                            reason: '유니크 보유 제한으로 연장',
                        };
                    }
                }
                const nextBidder = {
                    ...bidder,
                    role: { ...bidder.role, items: { ...bidder.role.items } },
                    itemInventory: cloneItemInventory(ensureItemInventory(bidder)),
                };
                equipNewItem(nextBidder, slot, itemKey, {
                    ...(itemModule.initialCharges === undefined ? {} : { charges: itemModule.initialCharges }),
                });
                world.updateGeneral(bidder.id, {
                    role: nextBidder.role,
                    itemInventory: nextBidder.itemInventory,
                });

                logs.push(
                    ...buildUniqueAuctionAwardLogs({
                        bidder,
                        nationName: world.getNationById(bidder.nationId)?.name ?? '재야',
                        itemName: itemModule.name,
                        itemRawName: itemModule.rawName,
                    })
                );

                const bidderUserId = await getGeneralUserId(db, bidder.id);
                if (bidderUserId) {
                    const state = world.getState();
                    await db.inheritanceLog.create({
                        data: buildUniqueAuctionInheritanceLogData({
                            userId: bidderUserId,
                            year: state.currentYear,
                            month: state.currentMonth,
                            itemName: itemModule.name,
                            amount: highestBid.amount,
                        }),
                    });
                }
            }

            logs.push(...globalLogger.flush());
            pushLogs(world, logs);
            await finalizeStatus('FINISHED');

            return { type: 'auctionFinalize', ok: true, auctionId };
        },
        close: async () => {
            await connector.disconnect();
        },
    };
};
