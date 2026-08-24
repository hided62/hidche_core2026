import { describe, expect, it, vi } from 'vitest';

import { ChangeJournal } from '@sammo-ts/common';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { appRouter } from '../src/router.js';

const baseGeneral: GeneralRow = {
    id: 22,
    userId: 'user-22',
    name: '인사담당',
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
    strength: 70,
    intel: 70,
    injury: 0,
    experience: 0,
    dedication: 0,
    officerLevel: 5,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    weaponCode: 'None',
    bookCode: 'None',
    horseCode: 'None',
    itemCode: 'None',
    turnTime: new Date('2026-01-01T00:00:00.000Z'),
    recentWarTime: null,
    age: 20,
    startAge: 20,
    personalCode: 'None',
    specialCode: 'None',
    special2Code: 'None',
    lastTurn: {},
    meta: { killturn: 24, belong: 5, permission: 'normal' },
    penalty: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
    sessionId: 'session-22',
    user: { id: 'user-22', username: 'tester', displayName: 'Tester', roles: [] },
    sanctions: {},
};

const createContext = (
    options: {
        me?: GeneralRow;
        db?: Record<string, unknown>;
        requestCommand?: ReturnType<typeof vi.fn>;
        requestId?: string;
        transaction?: ReturnType<typeof vi.fn>;
        changeJournal?: ChangeJournal;
    } = {}
): GameApiContext => {
    const requestCommand = options.requestCommand ?? vi.fn();
    const redisClient = { get: async () => null, set: async () => null };
    const db = {
        ...(options.transaction ? { $transaction: options.transaction } : {}),
        general: { findFirst: vi.fn(async () => options.me ?? baseGeneral) },
        ...options.db,
    };
    return {
        db: db as unknown as DatabaseClient,
        redis: {} as RedisConnector['client'],
        turnDaemon: { requestCommand } as unknown as TurnDaemonTransport,
        battleSim: {} as GameApiContext['battleSim'],
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        auth,
        ...(options.changeJournal ? { changeJournal: options.changeJournal } : {}),
        ...(options.requestId ? { requestId: options.requestId } : {}),
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore: new RedisAccessTokenStore(redisClient, 'che:default'),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
};

const listRow = (overrides: Record<string, unknown>) => ({
    id: 1,
    name: '장수1',
    npcState: 0,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    picture: 'default.jpg',
    imageServer: 0,
    officerLevel: 1,
    leadership: 70,
    strength: 70,
    intel: 70,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    personalCode: 'None',
    specialCode: 'None',
    special2Code: 'None',
    meta: { belong: 5, permission: 'normal' },
    penalty: {},
    ...overrides,
});

describe('nation personnel router', () => {
    it('always dispatches the authenticated general and never accepts a client actor id', async () => {
        const requestCommand = vi
            .fn()
            .mockResolvedValueOnce({ type: 'appoint', ok: true, generalId: 22 })
            .mockResolvedValueOnce({ type: 'kick', ok: true, generalId: 22 })
            .mockResolvedValueOnce({ type: 'changePermission', ok: true, generalId: 22 });
        const caller = appRouter.createCaller(createContext({ requestCommand }));

        await caller.nation.appoint({ destGeneralId: 7, destCityId: 1, officerLevel: 4 });
        await caller.nation.kick({ destGeneralId: 8 });
        await caller.nation.changePermission({ isAmbassador: true, targetGeneralIds: [9] });

        expect(requestCommand.mock.calls).toEqual([
            [{ type: 'appoint', generalId: 22, destGeneralId: 7, destCityId: 1, officerLevel: 4 }],
            [{ type: 'kick', generalId: 22, destGeneralId: 8 }],
            [{ type: 'changePermission', generalId: 22, isAmbassador: true, targetGeneralIds: [9] }],
        ]);
    });

    it('keeps nation personnel commands out of the API transaction and gives ENGINE a stable request id', async () => {
        const transaction = vi.fn(async () => {
            throw new Error('API transaction must not run');
        });
        const requestCommand = vi.fn(async () => ({ type: 'kick', ok: true, generalId: 22 }));
        const caller = appRouter.createCaller(
            createContext({ requestId: 'http-nation-kick', transaction, requestCommand })
        );

        await expect(caller.nation.kick({ destGeneralId: 8 })).resolves.toEqual({ ok: true });
        expect(transaction).not.toHaveBeenCalled();
        expect(requestCommand).toHaveBeenCalledWith({
            type: 'kick',
            requestId: 'http-nation-kick:nation.kick:engine:0:kick',
            generalId: 22,
            destGeneralId: 8,
        });
    });

    it('rejects oversized and duplicate permission selections before daemon dispatch', async () => {
        const requestCommand = vi.fn();
        const caller = appRouter.createCaller(createContext({ requestCommand }));
        await expect(
            caller.nation.changePermission({ isAmbassador: true, targetGeneralIds: [1, 2, 3] })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(
            caller.nation.changePermission({ isAmbassador: false, targetGeneralIds: [1, 1] })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        expect(requestCommand).not.toHaveBeenCalled();
    });

    it('redacts management candidates for an ordinary member but keeps appointed officers and awards visible', async () => {
        const me = { ...baseGeneral, officerLevel: 1 };
        const rows = [
            listRow({ id: 22, name: '일반인', officerLevel: 1 }),
            listRow({ id: 30, name: '군사', officerLevel: 3, meta: { belong: 8, officerCity: 1 } }),
            listRow({ id: 31, name: '후보', officerLevel: 1, gold: 99_999, rice: 99_999 }),
        ];
        const context = createContext({
            me,
            db: {
                nation: {
                    findUnique: vi.fn(async () => ({
                        id: 1,
                        name: '위',
                        color: '#777777',
                        level: 3,
                        typeCode: 'che_법가',
                        capitalCityId: 1,
                        meta: { chief_set: 0 },
                    })),
                },
                city: {
                    findMany: vi.fn(async () => [
                        { id: 1, name: '허창', level: 7, region: 2, meta: { officer_set: 0 } },
                    ]),
                },
                troop: { findMany: vi.fn(async () => []) },
                general: {
                    findFirst: vi.fn(async () => me),
                    findMany: vi.fn(async () => rows),
                },
                worldState: { findFirst: vi.fn(async () => ({ config: { stat: { chiefMin: 65 } } })) },
                rankData: {
                    findMany: vi.fn(async () => [{ generalId: 30, type: 'firenum', value: 7 }]),
                },
            },
        });

        const result = await appRouter.createCaller(context).nation.getPersonnelInfo();
        expect(result.me).toMatchObject({ id: 22, canManage: false, canChangePermissions: false, canKick: false });
        expect(result.generals.map((general) => general.id)).toEqual([30]);
        expect(result.permissionCandidates).toEqual({ ambassadors: [], auditors: [] });
        expect(result.cityAssignments[0]?.officers[3]?.name).toBe('군사');
        expect(result.cityAssignments[0]?.officers[3]).toMatchObject({
            stats: { leadership: 0, strength: 0, intelligence: 0 },
            gold: 0,
            rice: 0,
            crew: 0,
            troopId: 0,
        });
        expect(result.awards.eagles).toEqual([{ id: 30, name: '군사', value: 7 }]);
    });

    it('keeps ambassador and auditor candidate pools mutually exclusive like Ref', async () => {
        const me = { ...baseGeneral, officerLevel: 12 };
        const rows = [
            listRow({ id: 22, name: '군주', officerLevel: 12 }),
            listRow({ id: 30, name: '현 외교권자', meta: { belong: 5, permission: 'ambassador' } }),
            listRow({ id: 31, name: '현 조언자', meta: { belong: 5, permission: 'auditor' } }),
            listRow({ id: 32, name: '일반 후보' }),
            listRow({ id: 33, name: '외교 금지', penalty: { noAmbassador: true } }),
        ];
        const context = createContext({
            me,
            db: {
                nation: {
                    findUnique: vi.fn(async () => ({
                        id: 1,
                        name: '위',
                        color: '#777777',
                        level: 3,
                        typeCode: 'che_법가',
                        capitalCityId: 1,
                        meta: { chief_set: 0 },
                    })),
                },
                city: { findMany: vi.fn(async () => []) },
                troop: { findMany: vi.fn(async () => []) },
                general: {
                    findFirst: vi.fn(async () => me),
                    findMany: vi.fn(async () => rows),
                },
                worldState: { findFirst: vi.fn(async () => ({ config: { stat: { chiefMin: 65 } } })) },
                rankData: { findMany: vi.fn(async () => []) },
            },
        });

        const result = await appRouter.createCaller(context).nation.getPersonnelInfo();
        expect(result.permissionCandidates.ambassadors.map((candidate) => candidate.id)).toEqual([30, 32]);
        expect(result.permissionCandidates.auditors.map((candidate) => candidate.id)).toEqual([31, 32]);
    });

    it('allows finance mutations only for a head officer or an eligible ambassador', async () => {
        const nationDb = {
            nation: {
                findUnique: vi.fn(async () => ({ meta: { _updatedAt: '2026-01-01T00:00:00.000Z' } })),
            },
        };
        const makeCommand = () =>
            vi.fn(async () => ({
                type: 'setNationMeta',
                ok: true,
                nationId: 1,
                updatedAt: '2026-01-01T00:01:00.000Z',
            }));

        const headCommand = makeCommand();
        const changeJournal = new ChangeJournal();
        await expect(
            appRouter
                .createCaller(createContext({ db: nationDb, requestCommand: headCommand, changeJournal }))
                .nation.setRate({ amount: 20 })
        ).resolves.toEqual({ ok: true });
        expect(headCommand).toHaveBeenCalledWith({
            type: 'setNationMeta',
            nationId: 1,
            updates: { rate: 20 },
            expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
        });
        expect(changeJournal.snapshot()).toEqual([
            { domain: 'dashboard.global', entityId: 0 },
            { domain: 'nation.content', entityId: 1 },
        ]);

        const ambassadorCommand = makeCommand();
        const ambassador = {
            ...baseGeneral,
            officerLevel: 1,
            meta: { killturn: 24, belong: 5, permission: 'ambassador' },
        };
        await expect(
            appRouter
                .createCaller(createContext({ me: ambassador, db: nationDb, requestCommand: ambassadorCommand }))
                .nation.setRate({ amount: 25 })
        ).resolves.toEqual({ ok: true });

        const memberCommand = makeCommand();
        const member = { ...baseGeneral, officerLevel: 1 };
        await expect(
            appRouter
                .createCaller(createContext({ me: member, db: nationDb, requestCommand: memberCommand }))
                .nation.setRate({ amount: 25 })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(memberCommand).not.toHaveBeenCalled();
    });
});
