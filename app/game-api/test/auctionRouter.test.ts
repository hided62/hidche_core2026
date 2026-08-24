import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { GamePrisma, RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { appRouter } from '../src/router.js';
import { hasAuctionClosePassed } from '../src/router/auction/index.js';

const buildGeneral = (overrides: Partial<GeneralRow> = {}): GeneralRow => ({
    id: 7,
    userId: 'user-1',
    name: '유비',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    npcState: 0,
    affinity: null,
    bornYear: 180,
    deadYear: 300,
    picture: null,
    imageServer: 0,
    leadership: 50,
    strength: 50,
    intel: 50,
    injury: 0,
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    gold: 10_000,
    rice: 10_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    weaponCode: 'None',
    bookCode: 'None',
    horseCode: 'None',
    itemCode: 'None',
    turnTime: new Date('2026-07-26T00:00:00Z'),
    recentWarTime: null,
    age: 20,
    startAge: 20,
    personalCode: 'None',
    specialCode: 'None',
    special2Code: 'None',
    lastTurn: {},
    meta: {},
    penalty: {},
    createdAt: new Date('2026-07-26T00:00:00Z'),
    updatedAt: new Date('2026-07-26T00:00:00Z'),
    ...overrides,
});

const buildAuth = (userId = 'user-1'): GameSessionTokenPayload => ({
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-07-26T00:00:00.000Z',
    expiresAt: '2026-07-27T00:00:00.000Z',
    sessionId: `session-${userId}`,
    user: {
        id: userId,
        username: userId,
        displayName: userId,
        roles: [],
    },
    sanctions: {},
});

const sqlText = (query: GamePrisma.Sql): string => query.strings.join(' ');

const buildContext = (options: {
    auth?: GameSessionTokenPayload | null;
    general?: GeneralRow | null;
    auctions?: Array<Record<string, unknown>>;
    queryRaw?: (query: GamePrisma.Sql) => Promise<unknown>;
    isUnited?: number;
    isunited?: number;
    requestId?: string;
    transaction?: ReturnType<typeof vi.fn>;
    clockTick?: number;
    daemonResult?: Awaited<ReturnType<TurnDaemonTransport['requestCommand']>>;
}) => {
    const auth = options.auth === undefined ? buildAuth() : options.auth;
    const general = options.general === undefined ? buildGeneral() : options.general;
    const requestCommand = vi.fn(async (command: { type: string }) => {
        if (options.daemonResult !== undefined) {
            return options.daemonResult;
        }
        if (command.type === 'auctionOpen') {
            return {
                type: 'auctionOpen' as const,
                ok: true as const,
                auctionId: 91,
                closeAt: '2026-07-27T00:00:00.000Z',
            };
        }
        return {
            type: 'auctionBid' as const,
            ok: true as const,
            auctionId: 91,
            closeAt: '2026-07-27T00:00:00.000Z',
        };
    });
    const queryRaw = vi.fn(options.queryRaw ?? (async () => []));
    const worldState = {
        id: 1,
        scenarioCode: 'default',
        currentYear: 200,
        currentMonth: 1,
        tickSeconds: 3600,
        ...(options.clockTick === undefined
            ? {}
            : {
                  clockBaseTime: new Date('2026-07-26T00:00:00.000Z'),
                  clockTick: BigInt(options.clockTick),
                  clockMode: 'manual',
                  clockWallAnchor: new Date('2026-07-26T00:00:00.000Z'),
              }),
        config: {
            const: {
                auctionName: ['청룡', '백호', '주작', '현무'],
                allItems: { weapon: { che_무기_12_칠성검: 1 } },
            },
        },
        meta: { hiddenSeed: 'auction-hidden-seed', isUnited: options.isUnited ?? 0, isunited: options.isunited ?? 0 },
        updatedAt: new Date('2026-07-26T00:00:00Z'),
    };
    const db = {
        ...(options.transaction ? { $transaction: options.transaction } : {}),
        $queryRaw: queryRaw,
        general: {
            findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
                general?.userId === where.userId ? general : null
            ),
            findMany: vi.fn(async ({ where }: { where: { id: { in: number[] } } }) =>
                where.id.in.map((id) => ({ id, name: id === 88 ? '관우' : '조조' }))
            ),
        },
        auction: {
            findMany: vi.fn(async () => options.auctions ?? []),
            findFirst: vi.fn(async () => null),
        },
        worldState: {
            findFirst: vi.fn(async () => worldState),
        },
        inheritancePoint: {
            findUnique: vi.fn(async () => ({ value: 10_000 })),
        },
        logEntry: {
            findMany: vi.fn(async () => []),
        },
    };
    const redis = {
        zAdd: vi.fn(async () => 1),
    };
    const accessTokenStore = new RedisAccessTokenStore(
        {
            get: async () => null,
            set: async () => null,
        },
        'che:default'
    );
    const context: GameApiContext = {
        db: db as unknown as DatabaseClient,
        redis: redis as unknown as RedisConnector['client'],
        turnDaemon: { requestCommand } as unknown as TurnDaemonTransport,
        battleSim: {} as GameApiContext['battleSim'],
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        auth,
        ...(options.requestId ? { requestId: options.requestId } : {}),
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore,
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
    return { context, db, queryRaw, redis, requestCommand };
};

describe('auction router actor and permission boundaries', () => {
    it('keeps the auction open through its authoritative close tick', () => {
        const closeAt = new Date('2026-07-27T00:00:00.000Z');
        const auction = { closeAt, closeTick: 72_000_000n };

        expect(hasAuctionClosePassed(auction, { now: closeAt, tick: 72_000_000 })).toBe(false);
        expect(
            hasAuctionClosePassed(auction, {
                now: new Date(closeAt.getTime() + 1),
                tick: 72_000_001,
            })
        ).toBe(true);
        expect(hasAuctionClosePassed({ closeAt, closeTick: null }, { now: closeAt, tick: null })).toBe(false);
    });

    it('rejects unauthenticated auction reads', async () => {
        const fixture = buildContext({ auth: null });

        await expect(appRouter.createCaller(fixture.context).auction.getOverview()).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
    });

    it('rejects reads and mutations when the authenticated user owns no general', async () => {
        const fixture = buildContext({
            auth: buildAuth('user-2'),
            general: buildGeneral({ userId: 'user-1' }),
        });
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.auction.getOverview()).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
            message: 'General not found.',
        });
        await expect(
            caller.auction.openBuyRice({
                amount: 1000,
                closeTurnCnt: 3,
                startBidAmount: 500,
                finishBidAmount: 2000,
            })
        ).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
            message: 'General not found.',
        });
        expect(fixture.requestCommand).not.toHaveBeenCalled();
    });

    it('derives the daemon actor from the session-owned general and ignores a forged generalId field', async () => {
        const fixture = buildContext({ general: buildGeneral({ id: 7, userId: 'user-1' }) });
        const input = {
            amount: 1000,
            closeTurnCnt: 3,
            startBidAmount: 500,
            finishBidAmount: 2000,
            generalId: 999,
        };

        await appRouter.createCaller(fixture.context).auction.openBuyRice(input);

        expect(fixture.requestCommand).toHaveBeenCalledWith({
            type: 'auctionOpen',
            auctionType: 'BUY_RICE',
            userId: 'user-1',
            generalId: 7,
            amount: 1000,
            closeTurnCnt: 3,
            startBidAmount: 500,
            finishBidAmount: 2000,
        });
    });

    it('opens an auction without an API input-event transaction and preserves the ENGINE request identity', async () => {
        const transaction = vi.fn(async () => {
            throw new Error('API transaction must not run');
        });
        const fixture = buildContext({ requestId: 'http-auction-open', transaction });

        await expect(
            appRouter.createCaller(fixture.context).auction.openBuyRice({
                amount: 1000,
                closeTurnCnt: 3,
                startBidAmount: 500,
                finishBidAmount: 2000,
            })
        ).resolves.toMatchObject({ auctionId: 91 });

        expect(transaction).not.toHaveBeenCalled();
        expect(fixture.requestCommand).toHaveBeenCalledWith({
            type: 'auctionOpen',
            requestId: 'http-auction-open:auction.openBuyRice:engine:0:auctionOpen',
            auctionType: 'BUY_RICE',
            userId: 'user-1',
            generalId: 7,
            amount: 1000,
            closeTurnCnt: 3,
            startBidAmount: 500,
            finishBidAmount: 2000,
        });
    });

    it('opens a sell-rice auction with only the authenticated actor and a stable ENGINE request identity', async () => {
        const transaction = vi.fn(async () => {
            throw new Error('API transaction must not run');
        });
        const fixture = buildContext({ requestId: 'http-auction-open-sell', transaction });
        const input = {
            amount: 1000,
            closeTurnCnt: 3,
            startBidAmount: 500,
            finishBidAmount: 2000,
            userId: 'forged-user',
            generalId: 999,
        };

        await expect(appRouter.createCaller(fixture.context).auction.openSellRice(input)).resolves.toMatchObject({
            auctionId: 91,
        });

        expect(transaction).not.toHaveBeenCalled();
        expect(fixture.requestCommand).toHaveBeenCalledWith({
            type: 'auctionOpen',
            requestId: 'http-auction-open-sell:auction.openSellRice:engine:0:auctionOpen',
            auctionType: 'SELL_RICE',
            userId: 'user-1',
            generalId: 7,
            amount: 1000,
            closeTurnCnt: 3,
            startBidAmount: 500,
            finishBidAmount: 2000,
        });
    });

    it('rejects auction mutations after unification before sending a daemon command', async () => {
        const fixture = buildContext({ isUnited: 0, isunited: 2 });
        const caller = appRouter.createCaller(fixture.context);

        await expect(
            caller.auction.openBuyRice({
                amount: 1000,
                closeTurnCnt: 3,
                startBidAmount: 500,
                finishBidAmount: 2000,
            })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '천하통일 후에는 경매를 이용할 수 없습니다.',
        });
        await expect(caller.auction.bidUnique({ auctionId: 31, amount: 110 })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '천하통일 후에는 경매를 이용할 수 없습니다.',
        });
        expect(fixture.requestCommand).not.toHaveBeenCalled();
    });

    it('redacts real unique-auction identities while preserving caller markers', async () => {
        const openedAt = new Date('2026-07-26T01:00:00Z');
        const fixture = buildContext({
            auctions: [
                {
                    id: 31,
                    type: 'UNIQUE_ITEM',
                    targetCode: 'che_무기_12_칠성검',
                    hostGeneralId: 7,
                    hostName: null,
                    detail: { title: '칠성검 경매', startBidAmount: 5000 },
                    status: 'OPEN',
                    closeAt: new Date('2026-07-27T00:00:00Z'),
                    bids: [
                        {
                            id: 41,
                            generalId: 88,
                            amount: 5500,
                            eventAt: openedAt,
                        },
                    ],
                },
            ],
        });

        const result = await appRouter.createCaller(fixture.context).auction.getOverview();
        const unique = result.uniqueAuctions[0];

        expect(unique).toMatchObject({
            id: 31,
            hostGeneralId: null,
            isCallerHost: true,
            highestBid: { amount: 5500, isCaller: false },
        });
        expect(unique?.hostName).not.toBe('유비');
        expect(unique?.highestBid?.bidderName).not.toBe('관우');
        expect(JSON.stringify(unique)).not.toContain('"generalId"');
        expect(JSON.stringify(unique)).not.toContain('"hostGeneralId":7');
    });

    it('keeps the legacy default of no requested close extension for a unique bid', async () => {
        const fixture = buildContext({
            queryRaw: async (query) => {
                const text = sqlText(query);
                if (text.includes('FROM auction') && text.includes('WHERE id =')) {
                    return [
                        {
                            id: 31,
                            type: 'UNIQUE_ITEM',
                            targetCode: 'che_무기_12_칠성검',
                            hostGeneralId: 88,
                            detail: { startBidAmount: 100, isReverse: false },
                            status: 'OPEN',
                            closeAt: new Date(Date.now() + 60 * 60_000),
                            closeTick: 100n,
                        },
                    ];
                }
                if (text.includes('FROM auction_bid') && text.includes('general_id =')) {
                    return [];
                }
                if (text.includes('SELECT bid.auction_id')) {
                    return [{ auctionId: 31, generalId: 88, amount: 100 }];
                }
                if (text.includes('FROM auction_bid')) {
                    return [{ id: 41, generalId: 88, amount: 100, meta: {} }];
                }
                if (text.includes('SELECT id, target_code')) {
                    return [{ id: 31, targetCode: 'che_무기_12_칠성검' }];
                }
                return [];
            },
            clockTick: 100,
        });

        await appRouter.createCaller(fixture.context).auction.bidUnique({
            auctionId: 31,
            amount: 110,
        });

        expect(fixture.requestCommand).toHaveBeenCalledWith({
            type: 'auctionBid',
            userId: 'user-1',
            auctionId: 31,
            generalId: 7,
            amount: 110,
            acceptedGameTick: 100,
            tryExtendCloseDate: false,
        });
    });

    it('keeps the Ref 1000 gold reserve after a resource-auction bid', async () => {
        const queryRaw = async (query: GamePrisma.Sql) => {
            const text = sqlText(query);
            if (text.includes('FROM auction') && text.includes('WHERE id =')) {
                return [
                    {
                        id: 31,
                        type: 'BUY_RICE',
                        targetCode: '100',
                        hostGeneralId: 88,
                        detail: { title: '쌀 100 경매', amount: 100, startBidAmount: 500, isReverse: false },
                        status: 'OPEN',
                        closeAt: new Date(Date.now() + 60 * 60_000),
                    },
                ];
            }
            if (text.includes('FROM auction_bid')) {
                return [];
            }
            return [];
        };
        const accepted = buildContext({ general: buildGeneral({ gold: 1_500 }), queryRaw });

        await expect(
            appRouter.createCaller(accepted.context).auction.bidBuyRice({ auctionId: 31, amount: 500 })
        ).resolves.toEqual({ ok: true });
        expect(accepted.requestCommand).toHaveBeenCalledOnce();

        const rejected = buildContext({ general: buildGeneral({ gold: 1_499 }), queryRaw });
        await expect(
            appRouter.createCaller(rejected.context).auction.bidBuyRice({ auctionId: 31, amount: 500 })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: '금이 부족합니다.' });
        expect(rejected.requestCommand).not.toHaveBeenCalled();
    });

    it('bids rice through the authenticated actor and preserves the sell-rice ENGINE request identity', async () => {
        const queryRaw = async (query: GamePrisma.Sql) => {
            const text = sqlText(query);
            if (text.includes('FROM auction') && text.includes('WHERE id =')) {
                return [
                    {
                        id: 31,
                        type: 'SELL_RICE',
                        targetCode: '100',
                        hostGeneralId: 88,
                        detail: { title: '금 100 경매', amount: 100, startBidAmount: 500, isReverse: false },
                        status: 'OPEN',
                        closeAt: new Date('2026-07-27T00:00:00.000Z'),
                        closeTick: 200n,
                    },
                ];
            }
            if (text.includes('FROM auction_bid')) {
                return [];
            }
            return [];
        };
        const fixture = buildContext({
            general: buildGeneral({ id: 7, userId: 'user-1', rice: 1_500 }),
            queryRaw,
            requestId: 'http-auction-bid-sell',
            clockTick: 100,
        });
        const input = { auctionId: 31, amount: 500, userId: 'forged-user', generalId: 999 };

        await expect(appRouter.createCaller(fixture.context).auction.bidSellRice(input)).resolves.toEqual({ ok: true });
        expect(fixture.requestCommand).toHaveBeenCalledWith({
            type: 'auctionBid',
            requestId: 'http-auction-bid-sell:auction.bidSellRice:engine:0:auctionBid',
            userId: 'user-1',
            auctionId: 31,
            generalId: 7,
            amount: 500,
            acceptedGameTick: 100,
            tryExtendCloseDate: true,
        });
    });

    it('maps a rejected sell-rice bid without trusting client actor fields', async () => {
        const queryRaw = async (query: GamePrisma.Sql) => {
            const text = sqlText(query);
            if (text.includes('FROM auction') && text.includes('WHERE id =')) {
                return [
                    {
                        id: 31,
                        type: 'SELL_RICE',
                        targetCode: '100',
                        hostGeneralId: 88,
                        detail: { amount: 100, startBidAmount: 500, isReverse: false },
                        status: 'OPEN',
                        closeAt: new Date('2026-07-27T00:00:00.000Z'),
                        closeTick: 200n,
                    },
                ];
            }
            if (text.includes('FROM auction_bid')) {
                return [];
            }
            return [];
        };
        const fixture = buildContext({
            general: buildGeneral({ rice: 1_500 }),
            queryRaw,
            clockTick: 100,
            daemonResult: {
                type: 'auctionBid',
                ok: false,
                auctionId: 31,
                reason: '입찰이 취소되었습니다.',
            },
        });
        const input = { auctionId: 31, amount: 500, userId: 'forged-user', generalId: 999 };

        await expect(appRouter.createCaller(fixture.context).auction.bidSellRice(input)).rejects.toMatchObject({
            code: 'CONFLICT',
            message: '입찰이 취소되었습니다.',
        });
        expect(fixture.requestCommand).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'user-1', generalId: 7, auctionId: 31 })
        );
    });
});
