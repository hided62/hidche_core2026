import { createGamePostgresConnector, GamePrisma } from '@sammo-ts/infra';
import {
    ActionLogger,
    ItemLoader,
    LogFormat,
    UserLogger,
    isItemKey,
    resolveUniqueConfig,
} from '@sammo-ts/logic';
import { cloneItemInventory, ensureItemInventory, equipNewItem } from '@sammo-ts/logic/items/index.js';
import { asRecord, JosaUtil } from '@sammo-ts/common';

import type { TurnDaemonCommandResult } from '../lifecycle/types.js';
import type { InMemoryTurnWorld } from '../turn/inMemoryWorld.js';
import type { LogEntryDraft } from '@sammo-ts/logic';

export interface AuctionFinalizer {
    finalize(auctionId: number, db?: GamePrisma.TransactionClient): Promise<TurnDaemonCommandResult>;
    close(): Promise<void>;
}

type AuctionType = 'BUY_RICE' | 'SELL_RICE' | 'UNIQUE_ITEM';
type AuctionStatus = 'OPEN' | 'FINALIZING' | 'FINISHED' | 'CANCELED';

const COEFF_EXTENSION_MINUTES_PER_BID = 1 / 6;
const MIN_EXTENSION_MINUTES_PER_BID = 1;
const MIN_EXTENSION_MINUTES_LIMIT_BY_BID = 5;

interface AuctionRow {
    id: number;
    type: AuctionType;
    targetCode: string | null;
    hostGeneralId: number;
    hostName: string | null;
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

const refundInheritancePoint = async (options: {
    prisma: AuctionDb;
    userId: string;
    amount: number;
}): Promise<void> => {
    const { prisma, userId, amount } = options;
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
};

export const createAuctionFinalizer = async (options: {
    databaseUrl: string;
    world: InMemoryTurnWorld;
}): Promise<AuctionFinalizer> => {
    const connector = createGamePostgresConnector({ url: options.databaseUrl });
    await connector.connect();
    const prisma = connector.prisma;
    const world = options.world;
    const itemLoader = new ItemLoader();

    const getGeneralUserId = async (db: AuctionDb, generalId: number): Promise<string | null> => {
        const rows = await db.$queryRaw<{ userId: string | null }[]>(
            GamePrisma.sql`SELECT user_id as "userId" FROM general WHERE id = ${generalId}`
        );
        return rows[0]?.userId ?? null;
    };

    return {
        finalize: async (auctionId: number, commandDb): Promise<TurnDaemonCommandResult> => {
            const db = commandDb ?? prisma;
            const rows = await db.$queryRaw<AuctionRow[]>(
                GamePrisma.sql`
                    SELECT id,
                        type,
                        target_code as "targetCode",
                        host_general_id as "hostGeneralId",
                        host_name as "hostName",
                        detail,
                        status,
                        close_at as "closeAt"
                    FROM auction
                    WHERE id = ${auctionId}
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

            if (auction.status !== 'FINALIZING') {
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

            const now = new Date();
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

            if (!highestBid) {
                if (auction.type === 'BUY_RICE' || auction.type === 'SELL_RICE') {
                    const amount = detail.amount;
                    if (!amount || amount <= 0) {
                        await finalizeStatus('CANCELED');
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
                            await finalizeStatus('CANCELED');
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
                    }
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
                    const nextCloseAt = new Date(
                        auction.closeAt.getTime() + Math.max(5, turnMinutes) * 60_000
                    );
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
                                detail = ${JSON.stringify(nextDetail)}::jsonb,
                                close_at = ${nextCloseAt},
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
                await finalizeStatus('CANCELED');
                return {
                    type: 'auctionFinalize',
                    ok: false,
                    auctionId,
                    reason: '입찰자를 찾을 수 없습니다.',
                };
            }

            if (auction.type === 'BUY_RICE' || auction.type === 'SELL_RICE') {
                const amount = detail.amount;
                if (!amount || amount <= 0) {
                    await finalizeStatus('CANCELED');
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
                        await finalizeStatus('CANCELED');
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
                    await finalizeStatus('CANCELED');
                    return {
                        type: 'auctionFinalize',
                        ok: false,
                        auctionId,
                        reason: '유니크 아이템 정보가 없습니다.',
                    };
                }
                if (!isItemKey(itemKey)) {
                    await finalizeStatus('CANCELED');
                    return {
                        type: 'auctionFinalize',
                        ok: false,
                        auctionId,
                        reason: '아이템 키가 올바르지 않습니다.',
                    };
                }
                const itemModule = await itemLoader.load(itemKey).catch(() => null);
                if (!itemModule) {
                    await finalizeStatus('CANCELED');
                    await refundInheritancePoint({
                        prisma: db,
                        userId: (await getGeneralUserId(db, bidder.id)) ?? '',
                        amount: highestBid.amount,
                    });
                    return {
                        type: 'auctionFinalize',
                        ok: false,
                        auctionId,
                        reason: '아이템 정보를 불러올 수 없습니다.',
                    };
                }

                const state = world.getState();
                const config = resolveUniqueConfig(asRecord(world.getScenarioConfig().const));
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
                                host_general_id = ${bidder.id === auction.hostGeneralId ? auction.hostGeneralId : 0},
                                host_name = ${bidder.id === auction.hostGeneralId ? auction.hostName : '(상인)'},
                                detail = ${JSON.stringify(nextDetail)}::jsonb,
                                close_at = ${nextCloseAt},
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
                                Math.max(
                                    MIN_EXTENSION_MINUTES_PER_BID,
                                    turnMinutes * COEFF_EXTENSION_MINUTES_PER_BID
                                ) *
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
                                    host_general_id = ${bidder.id === auction.hostGeneralId ? auction.hostGeneralId : 0},
                                    host_name = ${bidder.id === auction.hostGeneralId ? auction.hostName : '(상인)'},
                                    detail = ${JSON.stringify(nextDetail)}::jsonb,
                                    close_at = ${nextCloseAt},
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

                const bidderLogger = new ActionLogger({ generalId: bidder.id, nationId: bidder.nationId });
                const josaUl = JosaUtil.pick(itemModule.rawName, '을');
                bidderLogger.pushGeneralActionLog(
                    `유니크 경매 낙찰로 ${itemModule.name}${josaUl} 획득했습니다.`,
                    LogFormat.PLAIN
                );
                logs.push(...bidderLogger.flush());

                const bidderUserId = await getGeneralUserId(db, bidder.id);
                if (bidderUserId) {
                    const userIdNum = Number(bidderUserId);
                    if (Number.isFinite(userIdNum)) {
                        const userLogger = new UserLogger(userIdNum);
                        userLogger.push(
                            `유니크 ${itemModule.name} 경매로 ${highestBid.amount} 포인트 사용`,
                            'inheritPoint'
                        );
                        logs.push(...userLogger.flush());
                    }
                }

                globalLogger.pushGlobalActionLog(`유니크 경매 ${auctionId}번이 성사되었습니다.`, LogFormat.PLAIN);
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
