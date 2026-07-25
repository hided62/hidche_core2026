import { randomUUID } from 'node:crypto';

import { asRecord, JosaUtil } from '@sammo-ts/common';
import { GamePrisma } from '@sammo-ts/infra';
import {
    ActionLogger,
    ItemLoader,
    LogFormat,
    buildAuctionAlias,
    isItemKey,
    resolveUniqueConfig,
} from '@sammo-ts/logic';

import type { TurnDaemonCommand, TurnDaemonCommandResult } from '../lifecycle/types.js';
import type { InMemoryTurnWorld } from '../turn/inMemoryWorld.js';

type AuctionOpenCommand = Extract<TurnDaemonCommand, { type: 'auctionOpen' }>;

const MIN_AUCTION_AMOUNT = 100;
const MAX_AUCTION_AMOUNT = 10_000;
const MIN_AUCTION_CLOSE_MINUTES = 30;
const COEFF_AUCTION_CLOSE_MINUTES = 24;
const MIN_EXTENSION_MINUTES_LIMIT_BY_BID = 5;
const COEFF_EXTENSION_MINUTES_LIMIT_BY_BID = 0.5;

const readNumber = (record: Record<string, unknown>, key: string, fallback: number): number => {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const getRelativeMonth = (world: InMemoryTurnWorld): number => {
    const state = world.getState();
    const meta = state.meta;
    const scenarioMeta = asRecord(meta.scenarioMeta);
    const initYear = readNumber(meta, 'initYear', readNumber(scenarioMeta, 'startYear', state.currentYear));
    const initMonth = readNumber(meta, 'initMonth', 1);
    return state.currentYear * 12 + state.currentMonth - (initYear * 12 + initMonth);
};

const fail = (reason: string): TurnDaemonCommandResult => ({
    type: 'auctionOpen',
    ok: false,
    reason,
});

const openResourceAuction = async (
    command: AuctionOpenCommand,
    world: InMemoryTurnWorld,
    db: GamePrisma.TransactionClient
): Promise<TurnDaemonCommandResult> => {
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return fail('장수 정보를 찾을 수 없습니다.');
    }
    const closeTurnCnt = command.closeTurnCnt ?? 0;
    const startBidAmount = command.startBidAmount ?? 0;
    const finishBidAmount = command.finishBidAmount ?? 0;
    if (closeTurnCnt < 1 || closeTurnCnt > 24) {
        return fail('종료기한은 1 ~ 24 턴 이어야 합니다.');
    }
    if (command.amount < MIN_AUCTION_AMOUNT || command.amount > MAX_AUCTION_AMOUNT) {
        return fail(`거래량은 ${MIN_AUCTION_AMOUNT} ~ ${MAX_AUCTION_AMOUNT} 이어야 합니다.`);
    }
    if (startBidAmount < command.amount * 0.5 || command.amount * 2 < startBidAmount) {
        return fail('시작거래가는 50% ~ 200% 이어야 합니다.');
    }
    if (finishBidAmount < command.amount * 1.1 || command.amount * 2 < finishBidAmount) {
        return fail('즉시거래가는 110% ~ 200% 이어야 합니다.');
    }
    if (finishBidAmount < startBidAmount * 1.1) {
        return fail('즉시거래가는 시작판매가의 110% 이상이어야 합니다.');
    }

    await db.$executeRaw(GamePrisma.sql`SELECT pg_advisory_xact_lock(${command.generalId}, 41001)`);
    const previous = await db.auction.findFirst({
        where: {
            hostGeneralId: command.generalId,
            status: { in: ['OPEN', 'FINALIZING'] },
            type: { in: ['BUY_RICE', 'SELL_RICE'] },
        },
        select: { id: true },
    });
    if (previous) {
        return fail('아직 경매가 끝나지 않았습니다.');
    }

    const configConst = asRecord(world.getScenarioConfig().const);
    const hostResource = command.auctionType === 'BUY_RICE' ? 'rice' : 'gold';
    const minimumResource =
        hostResource === 'rice'
            ? readNumber(configConst, 'generalMinimumRice', 500)
            : readNumber(configConst, 'generalMinimumGold', 0);
    if (general[hostResource] < command.amount + minimumResource) {
        return fail(`기본 ${hostResource === 'rice' ? '쌀' : '금'} ${minimumResource}은 거래할 수 없습니다.`);
    }

    const now = new Date();
    const turnMinutes = Math.max(1, Math.round(world.getState().tickSeconds / 60));
    const closeAt = new Date(now.getTime() + closeTurnCnt * turnMinutes * 60_000);
    const auction = await db.auction.create({
        data: {
            type: command.auctionType,
            targetCode: String(command.amount),
            hostGeneralId: command.generalId,
            hostName: general.name,
            detail: {
                title: `${hostResource === 'rice' ? '쌀' : '금'} ${command.amount} 경매`,
                hostName: general.name,
                amount: command.amount,
                isReverse: false,
                startBidAmount,
                finishBidAmount,
            },
            status: 'OPEN',
            closeAt,
        },
    });
    world.updateGeneral(general.id, {
        [hostResource]: general[hostResource] - command.amount,
    });
    return {
        type: 'auctionOpen',
        ok: true,
        auctionId: auction.id,
        closeAt: closeAt.toISOString(),
    };
};

const openUniqueAuction = async (
    command: AuctionOpenCommand,
    world: InMemoryTurnWorld,
    db: GamePrisma.TransactionClient
): Promise<TurnDaemonCommandResult> => {
    const general = world.getGeneralById(command.generalId);
    if (!general) {
        return fail('장수 정보를 찾을 수 없습니다.');
    }
    const itemKey = command.itemKey;
    if (!itemKey || !isItemKey(itemKey)) {
        return fail('아이템이 올바르지 않습니다.');
    }
    const configConst = asRecord(world.getScenarioConfig().const);
    const minimumPoint = readNumber(configConst, 'inheritItemUniqueMinPoint', 5000);
    if (command.amount < minimumPoint) {
        return fail(`최소 경매 금액은 ${minimumPoint}입니다.`);
    }

    const item = await new ItemLoader().load(itemKey).catch(() => null);
    if (!item) {
        return fail('아이템 정보를 불러올 수 없습니다.');
    }
    if (item.buyable) {
        return fail('구매할 수 있는 아이템입니다.');
    }
    const currentSlotItem = general.role.items[item.slot];
    if (currentSlotItem && currentSlotItem !== 'None' && isItemKey(currentSlotItem)) {
        const currentItem = await new ItemLoader().load(currentSlotItem).catch(() => null);
        if (currentItem && !currentItem.buyable) {
            return fail('이미 가진 아이템이 있습니다.');
        }
    }

    await db.$executeRaw(GamePrisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`auction:unique:item:${itemKey}`}))`);
    await db.$executeRaw(GamePrisma.sql`SELECT pg_advisory_xact_lock(${command.generalId}, 41002)`);
    const [sameItemAuction, previousHostAuction] = await Promise.all([
        db.auction.findFirst({
            where: {
                type: 'UNIQUE_ITEM',
                targetCode: itemKey,
                status: { in: ['OPEN', 'FINALIZING'] },
            },
            select: { id: true },
        }),
        db.auction.findFirst({
            where: {
                type: 'UNIQUE_ITEM',
                hostGeneralId: command.generalId,
                status: { in: ['OPEN', 'FINALIZING'] },
            },
            select: { id: true },
        }),
    ]);
    if (sameItemAuction) {
        return fail('이미 경매가 진행중입니다.');
    }
    if (previousHostAuction) {
        return fail('아직 경매가 끝나지 않았습니다.');
    }

    const uniqueConfig = resolveUniqueConfig(configConst);
    const configuredAmount = uniqueConfig.allItems[item.slot]?.[itemKey] ?? 0;
    const occupiedAmount = world
        .listGenerals()
        .filter((candidate) => candidate.role.items[item.slot] === itemKey).length;
    if (configuredAmount <= occupiedAmount) {
        return fail('그 유니크를 더 얻을 수 없습니다.');
    }

    const generalRows = await db.$queryRaw<Array<{ userId: string | null }>>(
        GamePrisma.sql`SELECT user_id as "userId" FROM general WHERE id = ${command.generalId}`
    );
    const userId = generalRows[0]?.userId;
    if (!userId) {
        return fail('장수 소유자 정보를 찾을 수 없습니다.');
    }
    const pointRows = await db.$queryRaw<Array<{ value: number }>>(
        GamePrisma.sql`
            SELECT value
            FROM inheritance_point
            WHERE user_id = ${userId} AND key = 'previous'
            FOR UPDATE
        `
    );
    const currentPoint = pointRows[0]?.value ?? 0;
    if (currentPoint < command.amount) {
        return fail('경매를 시작할 포인트가 부족합니다.');
    }

    const state = world.getState();
    const turnMinutes = Math.max(1, Math.round(state.tickSeconds / 60));
    const now = new Date();
    const closeMinutes = Math.max(MIN_AUCTION_CLOSE_MINUTES, turnMinutes * COEFF_AUCTION_CLOSE_MINUTES);
    const closeAt = new Date(now.getTime() + closeMinutes * 60_000);
    const extensionLimitMinutes = Math.max(
        MIN_EXTENSION_MINUTES_LIMIT_BY_BID,
        turnMinutes * COEFF_EXTENSION_MINUTES_LIMIT_BY_BID
    );
    const availableLatestBidCloseDate = new Date(closeAt.getTime() + extensionLimitMinutes * 60_000);
    const hiddenSeed =
        typeof state.meta.hiddenSeed === 'string' || typeof state.meta.hiddenSeed === 'number'
            ? state.meta.hiddenSeed
            : state.id;
    const alias = buildAuctionAlias(command.generalId, hiddenSeed, configConst);
    const eventId = randomUUID();
    const auction = await db.auction.create({
        data: {
            type: 'UNIQUE_ITEM',
            targetCode: itemKey,
            hostGeneralId: command.generalId,
            hostName: alias,
            detail: {
                title: `${item.name} 경매`,
                hostName: alias,
                amount: 1,
                isReverse: false,
                startBidAmount: command.amount,
                finishBidAmount: null,
                remainCloseDateExtensionCnt: 1,
                availableLatestBidCloseDate: availableLatestBidCloseDate.toISOString(),
            },
            status: 'OPEN',
            closeAt,
            latestEventId: eventId,
            latestEventAt: now,
            bids: {
                create: {
                    generalId: command.generalId,
                    amount: command.amount,
                    eventId,
                    eventAt: now,
                    meta: { obfuscatedName: alias, tryExtendCloseDate: false },
                },
            },
        },
    });
    await db.inheritancePoint.update({
        where: { userId_key: { userId, key: 'previous' } },
        data: { value: currentPoint - command.amount },
    });

    const logger = new ActionLogger();
    const rawNameJosa = JosaUtil.pick(item.rawName, '라');
    logger.pushGlobalHistoryLog(
        `<C><b>【보물수배】</b></>누군가가 <C>${item.name}</>${rawNameJosa}는 보물을 구한다는 소문이 들려옵니다.`,
        LogFormat.PLAIN
    );
    for (const log of logger.flush()) {
        world.pushLog(log);
    }

    return {
        type: 'auctionOpen',
        ok: true,
        auctionId: auction.id,
        closeAt: closeAt.toISOString(),
    };
};

export const openAuction = async (
    command: AuctionOpenCommand,
    world: InMemoryTurnWorld,
    db?: GamePrisma.TransactionClient
): Promise<TurnDaemonCommandResult> => {
    if (!db) {
        return fail('경매 등록 트랜잭션이 준비되지 않았습니다.');
    }
    if (getRelativeMonth(world) < 3) {
        return fail('시작 후 3개월이 지나야 경매를 열 수 있습니다.');
    }
    if (command.auctionType === 'UNIQUE_ITEM') {
        return openUniqueAuction(command, world, db);
    }
    return openResourceAuction(command, world, db);
};
