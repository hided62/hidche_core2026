import { describe, expect, it, vi } from 'vitest';

vi.mock('@sammo-ts/infra', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        createGamePostgresConnector: vi.fn(() => ({
            connect: vi.fn(async () => undefined),
            disconnect: vi.fn(async () => undefined),
            prisma: {},
        })),
    };
});

import {
    buildAuctionOutbidRefundMessage,
    createAuctionBidder,
    hasAuctionBidClosePassed,
    hasAuctionClosePassed,
    hasEnoughResourceForAuctionBid,
    MIN_AUCTION_REMAINING_RESOURCE,
} from '../src/auction/bidder.js';
import { normalizeTurnDaemonCommand } from '../src/turn/commandRegistry.js';
import type { TurnGeneral } from '../src/turn/types.js';

const bidder: TurnGeneral = {
    id: 7,
    name: '관우',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 80, strength: 90, intelligence: 70 },
    turnTime: new Date('0190-01-01T00:00:00.000Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    penalty: {},
    officerLevel: 1,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 2_000,
    rice: 2_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
    picture: 'generals/7.png',
};

const runDelayedResourceBid = async (finishImmediately: boolean) => {
    const acceptedAt = new Date('0190-02-01T00:00:00.000Z');
    const processingAt = new Date(acceptedAt.getTime() + 30 * 60_000);
    const general = {
        ...bidder,
        role: { ...bidder.role, items: { ...bidder.role.items } },
        meta: { ...bidder.meta },
    };
    const world = {
        getGameNow: () => processingAt,
        gameTickToDate: (tick: number) => new Date(acceptedAt.getTime() + (tick - 100) * 1_000),
        dateToGameTick: (date: Date) => 100 + Math.floor((date.getTime() - acceptedAt.getTime()) / 1_000),
        getState: () => ({ tickSeconds: 600 }),
        getGeneralById: (id: number) => (id === general.id ? general : null),
        updateGeneral: (_id: number, patch: Partial<TurnGeneral>) => Object.assign(general, patch),
    };
    const executeRaw = vi.fn(async (_query: unknown) => 1);
    const commandDb = {
        $queryRaw: vi.fn(async (query: { strings: readonly string[] }) => {
            const text = query.strings.join(' ');
            if (text.includes('FROM auction') && !text.includes('auction_bid')) {
                return [
                    {
                        id: 31,
                        type: 'BUY_RICE',
                        targetCode: '100',
                        hostGeneralId: 88,
                        detail: {
                            title: '쌀 100 경매',
                            amount: 100,
                            isReverse: false,
                            startBidAmount: 100,
                            finishBidAmount: finishImmediately ? 500 : null,
                        },
                        status: 'OPEN',
                        closeAt: new Date(acceptedAt.getTime() + 60_000),
                        closeTick: 160n,
                        latestEventId: 'previous-event',
                    },
                ];
            }
            return [];
        }),
        $executeRaw: executeRaw,
        $executeRawUnsafe: vi.fn(async () => 1),
    };
    const auctionBidder = await createAuctionBidder({
        databaseUrl: 'postgresql://unused',
        world: world as unknown as Parameters<typeof createAuctionBidder>[0]['world'],
    });
    const amount = finishImmediately ? 500 : 200;
    const result = await auctionBidder.bid(
        {
            type: 'auctionBid',
            userId: 'user-7',
            auctionId: 31,
            generalId: general.id,
            amount,
            acceptedGameTick: 100,
        },
        commandDb as any
    );
    await auctionBidder.close();

    const statements = executeRaw.mock.calls.map(
        ([query]) => query as { strings: readonly string[]; values: unknown[] }
    );
    const insert = statements.find((query) => query.strings.join(' ').includes('INSERT INTO auction_bid'));
    const update = statements.find((query) => query.strings.join(' ').includes('UPDATE auction'));
    return { acceptedAt, processingAt, result, insert, update };
};

describe('resource auction Ref compatibility', () => {
    it('keeps the auction open through its exact close tick', () => {
        const closeAt = new Date('0190-02-01T00:00:00.000Z');
        const auction = { closeAt, closeTick: 72_000_000n };

        expect(hasAuctionClosePassed(auction, closeAt, 72_000_000)).toBe(false);
        expect(hasAuctionClosePassed(auction, new Date(closeAt.getTime() + 1), 72_000_001)).toBe(true);
        expect(hasAuctionClosePassed({ closeAt, closeTick: null }, closeAt, null)).toBe(false);
        expect(hasAuctionClosePassed({ closeAt, closeTick: null }, new Date(closeAt.getTime() + 1), null)).toBe(true);
    });

    it('uses the durable API acceptance tick when queue processing crosses the close boundary', () => {
        const closeAt = new Date('0190-02-01T00:00:00.000Z');
        const auction = { closeAt, closeTick: 72_000_000n };
        const world = {
            dateToGameTick: () => 72_000_001,
            gameTickToDate: (tick: number) => (tick === 72_000_000 ? closeAt : new Date(closeAt.getTime() + 1)),
        };
        const processingNow = new Date(closeAt.getTime() + 1);

        expect(hasAuctionBidClosePassed(auction, world, processingNow, 72_000_000)).toBe(false);
        expect(hasAuctionBidClosePassed(auction, world, processingNow)).toBe(true);
        expect(
            normalizeTurnDaemonCommand({
                requestId: 'auction-bid-accepted-tick',
                sentAt: '2026-08-23T00:00:00.000Z',
                command: {
                    type: 'auctionBid',
                    userId: 'user-7',
                    auctionId: 31,
                    generalId: 7,
                    amount: 500,
                    acceptedGameTick: 72_000_000,
                },
            })
        ).toMatchObject({ acceptedGameTick: 72_000_000 });
    });

    it('uses the accepted logical time for delayed extension and persisted bid timestamps', async () => {
        const { acceptedAt, processingAt, result, insert, update } = await runDelayedResourceBid(false);

        expect(result).toMatchObject({ type: 'auctionBid', ok: true });
        expect(new Date(String(result && 'closeAt' in result ? result.closeAt : '')).getTime()).toBe(
            acceptedAt.getTime() + 100_000
        );
        expect(insert?.values.filter((value): value is Date => value instanceof Date)).toEqual([acceptedAt]);
        expect(update?.values.filter((value): value is Date => value instanceof Date)).toEqual([
            new Date(acceptedAt.getTime() + 100_000),
            acceptedAt,
            acceptedAt,
        ]);
        expect(update?.values).not.toContain(processingAt);
    });

    it('uses the accepted logical time for a delayed finish-price one-turn close', async () => {
        const { acceptedAt, result, update } = await runDelayedResourceBid(true);

        expect(result).toMatchObject({ type: 'auctionBid', ok: true });
        expect(new Date(String(result && 'closeAt' in result ? result.closeAt : '')).getTime()).toBe(
            acceptedAt.getTime() + 10 * 60_000
        );
        expect(update?.values[0]).toEqual(new Date(acceptedAt.getTime() + 10 * 60_000));
    });

    it('requires the bidder to retain the default 1000 resource', () => {
        expect(MIN_AUCTION_REMAINING_RESOURCE).toBe(1_000);
        expect(hasEnoughResourceForAuctionBid(1_500, 500)).toBe(true);
        expect(hasEnoughResourceForAuctionBid(1_499, 500)).toBe(false);
        expect(hasEnoughResourceForAuctionBid(2_000, 0)).toBe(false);
    });

    it('builds the receiver-only system message used by Ref refundBid', () => {
        const time = new Date('0190-02-01T00:00:00.000Z');
        const message = buildAuctionOutbidRefundMessage({
            auctionId: 31,
            title: '쌀 100 경매',
            bidder,
            nation: { name: '촉', color: '#ff0000' },
            time,
        });

        expect(message).toMatchObject({
            msgType: 'private',
            src: { generalId: 0, nationName: 'System' },
            dest: { generalId: 7, generalName: '관우', nationId: 1, nationName: '촉' },
            text: '31번 쌀 100 경매에 상회입찰자가 나타났습니다.',
            sendDestOnly: true,
        });
        expect(message.time).not.toBe(time);
        expect(message.time).toEqual(time);
    });
});
