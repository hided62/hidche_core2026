import { describe, expect, it, vi } from 'vitest';

import { ChangeJournal } from '@sammo-ts/common';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { GamePrisma, RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { appRouter } from '../src/router.js';
import { hasPollEnded } from '../src/router/vote/index.js';

const poll = {
    id: 1,
    title: '선호하는 병종',
    body: '',
    options: ['보병', '기병'],
    multiple_options: 1,
    reveal_mode: 'after_vote',
    opener_general_id: 1,
    opener_name: '관리자',
    start_at: new Date('2026-07-26T00:00:00Z'),
    end_at: null,
    closed_at: null,
};

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
    gold: 1000,
    rice: 1000,
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

const buildAuth = (roles: string[] = [], userId = 'user-1'): GameSessionTokenPayload => ({
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-07-26T00:00:00.000Z',
    expiresAt: '2026-07-27T00:00:00.000Z',
    sessionId: `session-${userId}`,
    user: {
        id: userId,
        username: userId,
        displayName: userId,
        roles,
    },
    sanctions: {},
});

const sqlText = (query: GamePrisma.Sql): string => query.strings.join(' ');

const buildContext = (options: {
    auth?: GameSessionTokenPayload | null;
    general?: GeneralRow | null;
    myVote?: number[] | null;
    voteRows?: Array<{ selection: number[]; cnt: number }>;
    pollRow?: typeof poll;
    configConst?: Record<string, unknown>;
    metaDevelCost?: number;
    auctionTargets?: string[];
    clockTick?: number;
    requestId?: string;
}) => {
    const auth = options.auth === undefined ? buildAuth() : options.auth;
    const general = options.general === undefined ? buildGeneral() : options.general;
    const requestCommand = vi.fn(async (_command?: unknown) => ({
        type: 'voteReward' as const,
        ok: true as const,
        voteId: 1,
        generalId: general?.id ?? 0,
        awardedUnique: false,
    }));
    const redisIncr = vi.fn(async (_key: string) => 41);
    const redisPublish = vi.fn(async (_channel: string, _message: string) => 1);
    const changeJournal = new ChangeJournal();
    const queryRaw = vi.fn(async (query: GamePrisma.Sql) => {
        const text = sqlText(query);
        if (text.includes('FROM vote_poll') && text.includes('LIMIT 1')) {
            return [options.pollRow ?? poll];
        }
        if (text.includes('INSERT INTO vote (')) {
            return [{ id: 11 }];
        }
        if (text.includes('FROM vote_comment')) {
            return [];
        }
        if (text.includes('SELECT selection') && text.includes('general_id')) {
            return options.myVote ? [{ selection: options.myVote }] : [];
        }
        if (text.includes('GROUP BY selection')) {
            return options.voteRows ?? [{ selection: [0], cnt: 2 }];
        }
        if (text.includes('INSERT INTO vote_comment')) {
            return [];
        }
        if (text.includes('UPDATE vote_poll')) {
            return [{ id: 1 }];
        }
        return [];
    });
    const db = {
        $queryRaw: queryRaw,
        worldState: {
            findFirst: vi.fn(async () => ({
                id: 1,
                scenarioCode: 'default',
                currentYear: 200,
                currentMonth: 1,
                tickSeconds: 3600,
                ...(options.clockTick === undefined
                    ? {}
                    : {
                          clockBaseTime: new Date('0200-01-01T00:00:00.000Z'),
                          clockTick: BigInt(options.clockTick),
                          clockMode: 'manual',
                          clockWallAnchor: new Date('2026-07-26T00:00:00.000Z'),
                      }),
                config: { const: { develCost: 18, allItems: {}, ...(options.configConst ?? {}) } },
                meta: {
                    ...(options.metaDevelCost === undefined ? {} : { develcost: options.metaDevelCost }),
                    hiddenSeed: 'seed',
                    scenarioId: 200,
                    initYear: 180,
                    initMonth: 1,
                    scenarioMeta: { startYear: 180 },
                },
                updatedAt: new Date(),
            })),
        },
        general: {
            findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
                general?.userId === where.userId ? general : null
            ),
            findMany: vi.fn(async () => [
                {
                    horseCode: general?.horseCode ?? 'None',
                    weaponCode: general?.weaponCode ?? 'None',
                    bookCode: general?.bookCode ?? 'None',
                    itemCode: general?.itemCode ?? 'None',
                },
            ]),
            count: vi.fn(async () => 2),
        },
        nation: {
            findFirst: vi.fn(async () => ({ name: '촉' })),
        },
        auction: {
            findMany: vi.fn(async () => (options.auctionTargets ?? []).map((targetCode) => ({ targetCode }))),
        },
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
        redis: {
            incr: redisIncr,
            publish: redisPublish,
        } as unknown as RedisConnector['client'],
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
        changeJournal,
    };
    return { context, requestCommand, queryRaw, db, redisIncr, redisPublish, changeJournal };
};

describe('vote router actor and permission boundaries', () => {
    it('keeps a poll open at its exact Ref end tick and closes it after that tick', () => {
        const now = new Date('2026-07-26T00:00:00Z');
        const time = {
            now,
            wallNow: now,
            tick: 100,
            mode: 'manual' as const,
            running: false,
            startsAt: null,
            dateToTick: () => 100,
        };

        expect(hasPollEnded({ closed_at: null, end_at: now, end_tick: 100n }, time)).toBe(false);
        expect(hasPollEnded({ closed_at: null, end_at: now, end_tick: 99n }, time)).toBe(true);
        expect(hasPollEnded({ closed_at: null, end_at: now, end_tick: null }, { ...time, tick: null })).toBe(true);
    });

    it('rejects unauthenticated survey access', async () => {
        const fixture = buildContext({ auth: null });

        await expect(appRouter.createCaller(fixture.context).vote.getVoteList()).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
    });

    it('uses only the general owned by the authenticated user for voting and reward dispatch', async () => {
        const owned = buildGeneral({ id: 7, userId: 'user-1', name: '유비' });
        const fixture = buildContext({ general: owned, clockTick: 100, requestId: 'http-vote-submit' });

        await expect(
            appRouter.createCaller(fixture.context).vote.submitVote({ voteId: 1, selection: [0] })
        ).resolves.toEqual({ ok: true, wonLottery: false });
        expect(fixture.requestCommand).toHaveBeenCalledWith({
            type: 'voteReward',
            requestId: 'http-vote-submit:vote.submitVote:engine:0:voteReward',
            userId: 'user-1',
            voteId: 1,
            generalId: 7,
            selection: [0],
        });
        expect(fixture.queryRaw.mock.calls.some(([query]) => sqlText(query).includes('INSERT INTO vote ('))).toBe(
            false
        );
        expect(fixture.changeJournal.snapshot()).toEqual([{ domain: 'front.general', entityId: 7 }]);
        expect(fixture.redisIncr).not.toHaveBeenCalled();
        expect(fixture.redisPublish).not.toHaveBeenCalled();
    });

    it('stores the authenticated general name and publishes a global projection after creating a survey', async () => {
        const auth = buildAuth(['admin.survey.open']);
        auth.user.username = 'admin-account';
        auth.user.displayName = '관리자 표시명';
        const fixture = buildContext({ auth, general: buildGeneral({ name: '관리자 장수' }) });

        await expect(
            appRouter.createCaller(fixture.context).vote.createPoll({
                title: '새 설문',
                options: ['찬성', '반대'],
                revealMode: 'after_vote',
            })
        ).resolves.toEqual({ ok: true });

        expect(fixture.changeJournal.snapshot()).toEqual([{ domain: 'front.global', entityId: 0 }]);
        expect(fixture.requestCommand).not.toHaveBeenCalled();
        expect(fixture.redisIncr).not.toHaveBeenCalled();
        expect(fixture.redisPublish).not.toHaveBeenCalled();
        const insert = fixture.queryRaw.mock.calls
            .map(([query]) => query)
            .find((query) => sqlText(query).includes('INSERT INTO vote_poll'));
        expect(insert?.values).toContain('관리자 장수');
        expect(insert?.values).not.toContain('admin-account');
        expect(insert?.values).not.toContain('관리자 표시명');
    });

    it('binds current operational timestamps in every raw SQL vote writer', async () => {
        const auth = buildAuth(['admin.survey.open']);
        const fixture = buildContext({ auth });
        const caller = appRouter.createCaller(fixture.context);
        await expect(caller.vote.addComment({ voteId: 1, text: '시각 댓글' })).resolves.toEqual({ ok: true });
        await expect(
            caller.vote.createPoll({
                title: '시각 설문',
                options: ['찬성', '반대'],
                revealMode: 'after_vote',
                closePrevious: true,
            })
        ).resolves.toEqual({ ok: true });
        await expect(caller.vote.updatePoll({ voteId: 1, title: '시각 설문 수정' })).resolves.toEqual({ ok: true });
        await expect(caller.vote.closePoll({ voteId: 1 })).resolves.toEqual({ ok: true });
        const mutationQueries = fixture.queryRaw.mock.calls
            .map(([query]) => query)
            .filter((query) => /INSERT INTO vote_comment|INSERT INTO vote_poll|UPDATE vote_poll/.test(sqlText(query)));
        const commentInsert = mutationQueries.find((query) => sqlText(query).includes('INSERT INTO vote_comment'));
        const pollInsert = mutationQueries.find((query) => sqlText(query).includes('INSERT INTO vote_poll'));
        const pollUpdates = mutationQueries.filter((query) => sqlText(query).includes('UPDATE vote_poll'));
        const closePreviousUpdate = pollUpdates.find((query) => sqlText(query).includes('WHERE closed_at IS NULL'));
        const editPollUpdate = pollUpdates.find((query) => sqlText(query).includes('title = COALESCE'));
        const closePollUpdate = pollUpdates.find((query) => sqlText(query).includes('RETURNING id'));
        const expectDbWallClock = (query: GamePrisma.Sql | undefined): void => {
            expect(query).toBeDefined();
            expect(sqlText(query!)).toContain("CURRENT_TIMESTAMP AT TIME ZONE 'UTC'");
        };

        expect(sqlText(commentInsert!)).toContain('created_at');
        expectDbWallClock(commentInsert);
        expect(sqlText(pollInsert!)).toContain('created_at');
        expect(sqlText(pollInsert!)).toContain('updated_at');
        expectDbWallClock(pollInsert);

        expect(pollUpdates).toHaveLength(3);
        expect(sqlText(closePreviousUpdate!)).toContain('updated_at');
        expectDbWallClock(closePreviousUpdate);
        expect(sqlText(editPollUpdate!)).toContain('updated_at');
        expectDbWallClock(editPollUpdate);
        expect(sqlText(closePollUpdate!)).toContain('updated_at');
        expectDbWallClock(closePollUpdate);
    });

    it('reports the current world develcost as the legacy five-times survey reward', async () => {
        const fixture = buildContext({ metaDevelCost: 30, configConst: { develCost: 0 } });

        await expect(appRouter.createCaller(fixture.context).vote.getVoteList()).resolves.toMatchObject({
            voteReward: 150,
        });
    });

    it('leaves live reward and unique occupancy calculation to ENGINE', async () => {
        const fixture = buildContext({
            configConst: {
                allItems: { weapon: { che_무기_12_칠성검: 1 } },
                maxUniqueItemLimit: [[-1, 1]],
                uniqueTrialCoef: 10,
                maxUniqueTrialProb: 10,
                minMonthToAllowInheritItem: 0,
            },
            auctionTargets: ['che_무기_12_칠성검'],
        });

        await appRouter.createCaller(fixture.context).vote.submitVote({ voteId: 1, selection: [0] });

        expect(fixture.db.general.findMany).not.toHaveBeenCalled();
        expect(fixture.db.general.count).not.toHaveBeenCalled();
        expect(fixture.db.auction.findMany).not.toHaveBeenCalled();
        expect(fixture.requestCommand.mock.calls[0]?.[0]).not.toHaveProperty('goldReward');
        expect(fixture.requestCommand.mock.calls[0]?.[0]).not.toHaveProperty('unique');
    });

    it('rejects voting and comments when the authenticated user owns no general', async () => {
        const fixture = buildContext({ auth: buildAuth([], 'user-2'), general: buildGeneral({ userId: 'user-1' }) });
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.vote.submitVote({ voteId: 1, selection: [0] })).rejects.toMatchObject({
            code: 'NOT_FOUND',
            message: 'General not found',
        });
        await expect(caller.vote.addComment({ voteId: 1, text: '댓글' })).rejects.toMatchObject({
            code: 'NOT_FOUND',
            message: 'General not found',
        });
        expect(fixture.requestCommand).not.toHaveBeenCalled();
    });

    it('rejects duplicate selections before persisting a vote', async () => {
        const fixture = buildContext({ pollRow: { ...poll, multiple_options: 2 } });

        await expect(
            appRouter.createCaller(fixture.context).vote.submitVote({ voteId: 1, selection: [0, 0] })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '선택한 항목이 올바르지 않습니다.',
        });
        expect(fixture.requestCommand).not.toHaveBeenCalled();
    });

    it('shows legacy-compatible aggregate results before the current general votes', async () => {
        const fixture = buildContext({ myVote: null, voteRows: [{ selection: [0], cnt: 2 }] });

        const result = await appRouter.createCaller(fixture.context).vote.getVoteDetail({ voteId: 1 });

        expect(result.myVote).toBeNull();
        expect(result.votes).toEqual([{ selection: [0], count: 2 }]);
    });

    it.each([
        ['global survey permission', ['admin.survey.open'], true],
        ['wildcard survey permission', ['admin.survey.open:*'], true],
        ['matching profile permission', ['admin.survey.open:che:default'], true],
        ['different profile permission', ['admin.survey.open:hwe:default'], false],
        ['ordinary user', ['user'], false],
    ])('%s controls the administrator panel', async (_label, roles, allowed) => {
        const fixture = buildContext({ auth: buildAuth(roles) });
        const request = appRouter.createCaller(fixture.context).vote.getAdminStatus();

        if (allowed) {
            await expect(request).resolves.toEqual({ ok: true });
        } else {
            await expect(request).rejects.toMatchObject({ code: 'FORBIDDEN' });
        }
    });
});
