import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { GamePrisma, RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { appRouter } from '../src/router.js';

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
}) => {
    const auth = options.auth === undefined ? buildAuth() : options.auth;
    const general = options.general === undefined ? buildGeneral() : options.general;
    const requestCommand = vi.fn(async (command: { type: string }) => {
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
        });

        await appRouter.createCaller(fixture.context).auction.bidUnique({
            auctionId: 31,
            amount: 110,
        });

        expect(fixture.requestCommand).toHaveBeenCalledWith({
            type: 'auctionBid',
            auctionId: 31,
            generalId: 7,
            amount: 110,
            tryExtendCloseDate: false,
        });
    });
});
