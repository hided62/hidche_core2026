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
    me?: GeneralRow;
    targets?: GeneralRow[];
    nationMeta?: Record<string, unknown>;
    requestCommand?: ReturnType<typeof vi.fn>;
}) => {
    const me = options.me ?? buildGeneral();
    const targets = options.targets ?? [me];
    const requestCommand =
        options.requestCommand ?? vi.fn(async () => ({ type: 'setMySetting', ok: true, generalId: me.id }));
    const generalFindUnique = vi.fn(
        async ({ where }: { where: { id: number } }) => targets.find((general) => general.id === where.id) ?? null
    );
    const db = {
        general: {
            findFirst: vi.fn(async () => me),
            findUnique: generalFindUnique,
            findMany: vi.fn(async () => targets.filter((general) => general.nationId === me.nationId)),
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
            findMany: vi.fn(async () => [{ id: 1, text: '기록' }]),
        },
    };
    const redisClient = { get: async () => null, set: async () => null };
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
        accessTokenStore: new RedisAccessTokenStore(redisClient, 'che:default'),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
    return { context, db, requestCommand };
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
});
