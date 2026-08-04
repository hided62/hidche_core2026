import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { GamePrisma, RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { appRouter } from '../src/router.js';

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
}) => {
    const auth = options.auth === undefined ? buildAuth() : options.auth;
    const general = options.general === undefined ? buildGeneral() : options.general;
    const requestCommand = vi.fn(async () => ({
        type: 'voteReward' as const,
        ok: true as const,
        voteId: 1,
        generalId: general?.id ?? 0,
        awardedUnique: false,
    }));
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
        redis: {} as RedisConnector['client'],
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
    return { context, requestCommand, queryRaw, db };
};

describe('vote router actor and permission boundaries', () => {
    it('rejects unauthenticated survey access', async () => {
        const fixture = buildContext({ auth: null });

        await expect(appRouter.createCaller(fixture.context).vote.getVoteList()).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
    });

    it('uses only the general owned by the authenticated user for voting and reward dispatch', async () => {
        const owned = buildGeneral({ id: 7, userId: 'user-1', name: '유비' });
        const fixture = buildContext({ general: owned });

        await expect(
            appRouter.createCaller(fixture.context).vote.submitVote({ voteId: 1, selection: [0] })
        ).resolves.toEqual({ ok: true, wonLottery: false });
        expect(fixture.requestCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'voteReward',
                voteId: 1,
                generalId: 7,
                goldReward: 90,
            })
        );
    });

    it('uses the current world develcost for the legacy five-times survey reward', async () => {
        const fixture = buildContext({ metaDevelCost: 30, configConst: { develCost: 0 } });

        await expect(appRouter.createCaller(fixture.context).vote.getVoteList()).resolves.toMatchObject({
            voteReward: 150,
        });
        await appRouter.createCaller(fixture.context).vote.submitVote({ voteId: 1, selection: [0] });
        expect(fixture.requestCommand).toHaveBeenCalledWith(expect.objectContaining({ goldReward: 150 }));
    });

    it('includes active unique auctions in the API-side reward expectation', async () => {
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

        expect(fixture.requestCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                unique: { expected: false, itemKey: null },
            })
        );
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
