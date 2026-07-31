import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { appRouter } from '../src/router.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const buildGeneral = (overrides: Partial<GeneralRow> = {}): GeneralRow => ({
    id: 7,
    userId: 'user-7',
    name: '검증장수',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    npcState: 0,
    affinity: null,
    bornYear: 180,
    deadYear: 300,
    picture: 'default.jpg',
    imageServer: 0,
    leadership: 70,
    strength: 60,
    intel: 50,
    injury: 0,
    experience: 10,
    dedication: 20,
    officerLevel: 1,
    gold: 1_000,
    rice: 1_000,
    crew: 100,
    crewTypeId: 0,
    train: 80,
    atmos: 80,
    weaponCode: 'None',
    bookCode: 'None',
    horseCode: 'None',
    itemCode: 'None',
    turnTime: now,
    recentWarTime: null,
    age: 20,
    startAge: 20,
    personalCode: 'None',
    specialCode: 'None',
    special2Code: 'None',
    lastTurn: {},
    meta: {
        belong: 1,
        permission: 'normal',
        myset: 3,
        tnmt: 0,
        defence_train: 80,
        use_treatment: 21,
        use_auto_nation_turn: 1,
    },
    penalty: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che:default',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    sessionId: 'session-7',
    user: { id: 'user-7', username: 'tester', displayName: 'Tester', roles: [] },
    sanctions: {},
};

const createContext = (options: {
    me?: GeneralRow | null;
    targets?: GeneralRow[];
    nationMeta?: Record<string, unknown>;
    requestCommand?: ReturnType<typeof vi.fn>;
    accessToken?: string;
    logs?: Array<{ id: number; text: string }>;
}) => {
    const me = options.me === undefined ? buildGeneral() : options.me;
    const targets = options.targets ?? (me ? [me] : []);
    const requestCommand =
        options.requestCommand ?? vi.fn(async () => ({ type: 'setMySetting', ok: true, generalId: me?.id ?? 0 }));
    const generalFindUnique = vi.fn(
        async ({ where }: { where: { id: number } }) => targets.find((general) => general.id === where.id) ?? null
    );
    const db = {
        general: {
            findFirst: vi.fn(async () => me),
            findUnique: generalFindUnique,
            findMany: vi.fn(async () => targets.filter((general) => general.nationId === (me?.nationId ?? 0))),
            update: vi.fn(),
        },
        city: { findUnique: vi.fn(async () => null) },
        nation: {
            findUnique: vi.fn(async () => ({
                id: 1,
                name: '위',
                color: '#777777',
                level: 3,
                gold: 10_000,
                rice: 20_000,
                tech: 100,
                typeCode: 'che_법가',
                capitalCityId: 1,
                meta: options.nationMeta ?? { secretlimit: 3 },
            })),
        },
        worldState: {
            findFirst: vi.fn(async () => ({
                currentYear: 185,
                currentMonth: 1,
                tickSeconds: 600,
            })),
        },
        logEntry: {
            groupBy: vi.fn(async () => []),
            findMany: vi.fn(async (query?: { where?: { id?: { lt?: number } }; take?: number }) => {
                const source = options.logs ?? [{ id: 1, text: '기록' }];
                const beforeId = query?.where?.id?.lt;
                const filtered = beforeId ? source.filter((entry) => entry.id < beforeId) : source;
                return query?.take ? filtered.slice(0, query.take) : filtered;
            }),
        },
    };
    const redisClient = { get: async () => null, set: async () => null };
    const accessTokenStore = new RedisAccessTokenStore(redisClient, 'che:default');
    const revokeAccessToken = vi.fn(async (_accessToken: string): Promise<boolean> => true);
    vi.spyOn(accessTokenStore, 'revoke').mockImplementation(revokeAccessToken);
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
        ...(options.accessToken ? { accessToken: options.accessToken } : {}),
        accessTokenStore,
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
    return { context, db, requestCommand, revokeAccessToken };
};

describe('in-game my information ownership', () => {
    it('reads legacy top-level settings and dispatches only the session-owned general', async () => {
        const requestCommand = vi.fn(async () => ({ type: 'setMySetting', ok: true, generalId: 7 }));
        const fixture = createContext({ requestCommand });
        const caller = appRouter.createCaller(fixture.context);

        const me = await caller.general.me();
        expect(me?.settings).toEqual({
            tnmt: 0,
            defence_train: 80,
            use_treatment: 21,
            use_auto_nation_turn: 1,
            myset: 3,
        });

        await caller.general.setMySetting({ tnmt: 1, defence_train: 999 });
        expect(requestCommand).toHaveBeenCalledWith({
            type: 'setMySetting',
            generalId: 7,
            settings: { tnmt: 1, defence_train: 999 },
        });
        expect(fixture.db.general.update).not.toHaveBeenCalled();
    });

    it('uses the authenticated user for both the page and its logs without accepting a target general id', async () => {
        const otherUser = buildGeneral({ id: 8, userId: 'user-8', name: '타유저' });
        const fixture = createContext({ targets: [buildGeneral(), otherUser] });
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.general.me()).resolves.toMatchObject({
            general: { id: 7, name: '검증장수' },
        });
        await expect(caller.general.getMyLog({ type: 'generalAction' })).resolves.toMatchObject({
            type: 'generalAction',
            logs: [{ id: 1 }],
        });

        expect(fixture.db.general.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { userId: 'user-7' },
            })
        );
        expect(fixture.db.logEntry.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ generalId: 7 }),
            })
        );
    });

    it('returns the complete personal history while preserving bounded action pages', async () => {
        const logs = Array.from({ length: 61 }, (_, index) => ({ id: 61 - index, text: `기록-${61 - index}` }));
        const fixture = createContext({ logs });
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.general.getMyLog({ type: 'generalHistory' })).resolves.toMatchObject({
            logs,
        });
        await expect(caller.general.getMyLog({ type: 'generalAction' })).resolves.toMatchObject({
            logs: logs.slice(0, 24),
        });
    });

    it('returns the three legacy front-page record streams for the session-owned general', async () => {
        const fixture = createContext({});
        const caller = appRouter.createCaller(fixture.context);

        await expect(
            caller.general.getRecentRecords({
                lastGeneralRecordId: 0,
                lastWorldHistoryId: 0,
            })
        ).resolves.toEqual({
            global: [{ id: 1, text: '기록' }],
            general: [{ id: 1, text: '기록' }],
            history: [{ id: 1, text: '기록' }],
        });

        expect(fixture.db.logEntry.findMany).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                where: { scope: 'SYSTEM', category: 'SUMMARY', id: { gte: 0 } },
                orderBy: { id: 'desc' },
                take: 16,
                select: { id: true, text: true },
            })
        );
        expect(fixture.db.logEntry.findMany).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                where: { scope: 'GENERAL', category: 'ACTION', generalId: 7, id: { gte: 0 } },
                orderBy: { id: 'desc' },
                take: 16,
                select: { id: true, text: true },
            })
        );
        expect(fixture.db.logEntry.findMany).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({
                where: { scope: 'SYSTEM', category: 'HISTORY', id: { gte: 0 } },
                orderBy: { id: 'desc' },
                take: 16,
                select: { id: true, text: true },
            })
        );
    });

    it.each([
        ['dieOnPrestart', 'dieOnPrestart'],
        ['buildNationCandidate', 'buildNationCandidate'],
        ['instantRetreat', 'instantRetreat'],
    ] as const)('dispatches %s only for the session-owned general', async (procedure, commandType) => {
        const clientRequestId = '11111111-1111-4111-8111-111111111111';
        const requestCommand = vi.fn(async () => ({
            type: commandType,
            ok: true,
            generalId: 7,
        }));
        const fixture = createContext({ requestCommand });
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.general[procedure]({ clientRequestId })).resolves.toEqual({ ok: true });
        expect(requestCommand).toHaveBeenCalledWith({
            type: commandType,
            requestId: `general:${commandType}:user-7:${clientRequestId}`,
            userId: 'user-7',
            generalId: 7,
        });
    });

    it('gets the server-owned pre-start deletion status without accepting a general id', async () => {
        const requestCommand = vi.fn(async () => ({
            type: 'ensureDieOnPrestartStatus' as const,
            generalId: 7,
            show: true,
            available: false,
            availableAt: '2026-01-01T00:20:00.000Z',
        }));
        const fixture = createContext({ requestCommand });

        await expect(appRouter.createCaller(fixture.context).general.ensureDieOnPrestartStatus()).resolves.toEqual({
            show: true,
            available: false,
            availableAt: '2026-01-01T00:20:00.000Z',
        });
        expect(requestCommand).toHaveBeenCalledWith({
            type: 'ensureDieOnPrestartStatus',
            userId: 'user-7',
            generalId: 7,
        });
        expect(fixture.db.general.findFirst).toHaveBeenCalledWith({
            where: { userId: 'user-7', npcState: 0 },
            select: { id: true },
        });
    });

    it('returns the daemon compatibility failure without performing an API-side mutation', async () => {
        const requestCommand = vi.fn(async () => ({
            type: 'instantRetreat' as const,
            ok: false,
            generalId: 7,
            reason: '가까운 아국 도시가 없습니다.',
        }));
        const fixture = createContext({ requestCommand });
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.general.instantRetreat()).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '가까운 아국 도시가 없습니다.',
        });
        expect(fixture.db.general.update).not.toHaveBeenCalled();
    });

    it('returns a retryable timeout while preserving the client request identity', async () => {
        const requestCommand = vi.fn(async () => null);
        const fixture = createContext({ requestCommand });
        const caller = appRouter.createCaller(fixture.context);
        const clientRequestId = '22222222-2222-4222-8222-222222222222';

        await expect(caller.general.instantRetreat({ clientRequestId })).rejects.toMatchObject({
            code: 'TIMEOUT',
            message: expect.stringContaining('같은 요청으로 다시 시도'),
        });
        expect(requestCommand).toHaveBeenCalledWith({
            type: 'instantRetreat',
            requestId: `general:instantRetreat:user-7:${clientRequestId}`,
            userId: 'user-7',
            generalId: 7,
        });
    });

    it('keeps the die-on-prestart request identity when its destructive result times out', async () => {
        const requestCommand = vi.fn(async () => null);
        const fixture = createContext({ requestCommand });
        const caller = appRouter.createCaller(fixture.context);
        const clientRequestId = '33333333-3333-4333-8333-333333333333';

        await expect(caller.general.dieOnPrestart({ clientRequestId })).rejects.toMatchObject({
            code: 'TIMEOUT',
            message: expect.stringContaining('같은 요청으로 다시 시도'),
        });
        expect(requestCommand).toHaveBeenCalledWith({
            type: 'dieOnPrestart',
            requestId: `general:dieOnPrestart:user-7:${clientRequestId}`,
            userId: 'user-7',
            generalId: 7,
        });
    });

    it('revokes only the current game access token after a successful prestart deletion', async () => {
        const requestCommand = vi.fn(async () => ({ type: 'dieOnPrestart', ok: true, generalId: 7 }));
        const fixture = createContext({ requestCommand, accessToken: 'ga_current' });

        await expect(appRouter.createCaller(fixture.context).general.dieOnPrestart()).resolves.toEqual({ ok: true });
        expect(fixture.revokeAccessToken).toHaveBeenCalledOnce();
        expect(fixture.revokeAccessToken).toHaveBeenCalledWith('ga_current');
    });

    it('keeps the current game access token after another successful immediate action', async () => {
        const requestCommand = vi.fn(async () => ({ type: 'instantRetreat', ok: true, generalId: 7 }));
        const fixture = createContext({ requestCommand, accessToken: 'ga_current' });

        await expect(appRouter.createCaller(fixture.context).general.instantRetreat()).resolves.toEqual({ ok: true });
        expect(fixture.revokeAccessToken).not.toHaveBeenCalled();
    });

    it('rejects deletion with the legacy no-general message before dispatching a daemon command', async () => {
        const requestCommand = vi.fn();
        const fixture = createContext({ me: null, requestCommand });

        await expect(appRouter.createCaller(fixture.context).general.dieOnPrestart()).rejects.toMatchObject({
            code: 'NOT_FOUND',
            message: '장수가 없습니다',
        });
        expect(fixture.db.general.findFirst).toHaveBeenCalledWith({
            where: { userId: 'user-7', npcState: 0 },
        });
        expect(requestCommand).not.toHaveBeenCalled();
    });
});

describe('battle-center general and user permissions', () => {
    it('distinguishes an ordinary member, a tenured member, and an auditor', async () => {
        const ordinary = createContext({
            me: buildGeneral({ officerLevel: 1, meta: { belong: 1, permission: 'normal' } }),
            nationMeta: { secretlimit: 3 },
        });
        await expect(appRouter.createCaller(ordinary.context).nation.getBattleCenter()).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });

        const tenured = createContext({
            me: buildGeneral({ officerLevel: 1, meta: { belong: 3, permission: 'normal' } }),
            nationMeta: { secretlimit: 3 },
        });
        await expect(appRouter.createCaller(tenured.context).nation.getBattleCenter()).resolves.toMatchObject({
            me: { id: 7, permissionLevel: 1 },
        });

        const auditor = createContext({
            me: buildGeneral({ officerLevel: 1, meta: { belong: 0, permission: 'auditor' } }),
            nationMeta: { secretlimit: 3 },
        });
        await expect(appRouter.createCaller(auditor.context).nation.getBattleCenter()).resolves.toMatchObject({
            me: { id: 7, permissionLevel: 3 },
        });
    });

    it('redacts another user action log while allowing own, NPC, chief, and non-private logs', async () => {
        const me = buildGeneral({ meta: { belong: 3, permission: 'normal' } });
        const otherUser = buildGeneral({ id: 8, userId: 'user-8', name: '타유저', npcState: 0 });
        const npc = buildGeneral({ id: 9, userId: null, name: 'NPC', npcState: 2 });
        const foreign = buildGeneral({ id: 10, userId: 'user-10', name: '타국', nationId: 2 });
        const memberFixture = createContext({
            me,
            targets: [me, otherUser, npc, foreign],
            nationMeta: { secretlimit: 3 },
        });
        const member = appRouter.createCaller(memberFixture.context);

        await expect(member.nation.getGeneralLog({ generalId: me.id, type: 'generalAction' })).resolves.toMatchObject({
            generalId: me.id,
        });
        await expect(
            member.nation.getGeneralLog({ generalId: otherUser.id, type: 'generalAction' })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(
            member.nation.getGeneralLog({ generalId: otherUser.id, type: 'battleDetail' })
        ).resolves.toMatchObject({ generalId: otherUser.id });
        await expect(member.nation.getGeneralLog({ generalId: npc.id, type: 'generalAction' })).resolves.toMatchObject({
            generalId: npc.id,
        });
        await expect(
            member.nation.getGeneralLog({ generalId: foreign.id, type: 'battleDetail' })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });

        const chiefFixture = createContext({
            me: buildGeneral({ officerLevel: 5 }),
            targets: [buildGeneral({ officerLevel: 5 }), otherUser],
            nationMeta: { secretlimit: 3 },
        });
        await expect(
            appRouter
                .createCaller(chiefFixture.context)
                .nation.getGeneralLog({ generalId: otherUser.id, type: 'generalAction' })
        ).resolves.toMatchObject({ generalId: otherUser.id });
    });

    it('returns all nation history and paginates action logs in legacy 30-row pages', async () => {
        const logs = Array.from({ length: 61 }, (_, index) => ({ id: 61 - index, text: `기록-${61 - index}` }));
        const fixture = createContext({
            me: buildGeneral({ officerLevel: 5 }),
            logs,
        });
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.nation.getGeneralLog({ generalId: 7, type: 'generalHistory' })).resolves.toMatchObject({
            logs,
        });
        await expect(caller.nation.getGeneralLog({ generalId: 7, type: 'generalAction' })).resolves.toMatchObject({
            logs: logs.slice(0, 30),
        });
        await expect(
            caller.nation.getGeneralLog({ generalId: 7, type: 'generalAction', beforeId: 32 })
        ).resolves.toMatchObject({ logs: logs.slice(30, 60) });
        await expect(
            caller.nation.getGeneralLog({ generalId: 7, type: 'generalAction', beforeId: 2 })
        ).resolves.toMatchObject({ logs: logs.slice(60) });
    });
});
