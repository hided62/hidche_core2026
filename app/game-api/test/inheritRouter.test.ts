import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { appRouter } from '../src/router.js';
import { resolveResetTurnTimeBase } from '../src/router/inherit/index.js';

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
    leadership: 70,
    strength: 45,
    intel: 85,
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
    special2Code: 'che_선봉',
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

const worldState = {
    id: 1,
    scenarioCode: 'default',
    currentYear: 200,
    currentMonth: 4,
    tickSeconds: 3600,
    config: {
        const: {
            availableSpecialWar: ['che_선봉'],
            allItems: {
                weapon: {
                    che_무기_12_칠성검: 1,
                    che_무기_01_단도: 0,
                },
            },
        },
    },
    meta: { hiddenSeed: 'test-seed', isUnited: 0, season: 1 },
    updatedAt: new Date('2026-07-26T00:00:00Z'),
};

const buildContext = (options: {
    auth?: GameSessionTokenPayload | null;
    general?: GeneralRow | null;
    target?: GeneralRow | null;
    inheritancePoint?: number;
    inheritanceLogs?: Array<{ id: number; year: number; month: number; text: string; createdAt: Date }>;
    configConst?: Record<string, unknown>;
}) => {
    const auth = options.auth === undefined ? buildAuth() : options.auth;
    const general = options.general === undefined ? buildGeneral() : options.general;
    const target =
        options.target === undefined
            ? buildGeneral({ id: 8, userId: 'user-2', name: '조조', meta: { ownerName: '위유저' } })
            : options.target;
    const requestCommand = vi.fn(async (command: { type: string; generalId: number }) => ({
        type: command.type,
        ok: true,
        generalId: command.generalId,
    }));
    const pointUpsert = vi.fn(async () => ({}));
    const logCreate = vi.fn(async () => ({}));
    const findMany = vi.fn(async () => (target ? [{ id: target.id, name: target.name }] : []));
    const inheritanceLogFindMany = vi.fn(async () => options.inheritanceLogs ?? []);
    const activeWorldState =
        options.configConst === undefined
            ? worldState
            : {
                  ...worldState,
                  config: {
                      const: options.configConst,
                  },
              };
    const db = {
        $queryRaw: vi.fn(async () => [{ value: options.inheritancePoint ?? 10_000 }]),
        worldState: {
            findFirst: vi.fn(async () => activeWorldState),
        },
        general: {
            findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
                general?.userId === where.userId ? general : null
            ),
            findMany,
            findUnique: vi.fn(async ({ where }: { where: { id: number } }) =>
                target?.id === where.id ? target : null
            ),
        },
        inheritancePoint: {
            upsert: pointUpsert,
        },
        inheritanceLog: {
            create: logCreate,
            findMany: inheritanceLogFindMany,
        },
        inheritanceUserState: {
            findUnique: vi.fn(async () => null),
            upsert: vi.fn(async () => ({})),
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
    return { context, requestCommand, pointUpsert, logCreate, findMany, inheritanceLogFindMany };
};

describe('inherit router actor and permission boundaries', () => {
    it('rejects unauthenticated status and mutations', async () => {
        const fixture = buildContext({ auth: null });
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.inherit.getStatus()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        await expect(caller.inherit.buyHiddenBuff({ type: 'warAvoidRatio', level: 1 })).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
        expect(fixture.requestCommand).not.toHaveBeenCalled();
    });

    it('builds status only from the authenticated user general and filters target generals like ref', async () => {
        const fixture = buildContext({});
        const status = await appRouter.createCaller(fixture.context).inherit.getStatus();

        expect(status.currentStat).toEqual({ leadership: 70, strength: 45, intel: 85 });
        expect(status.availableTargetGenerals).toEqual([{ id: 8, name: '조조' }]);
        expect(status.availableUnique).toEqual([
            expect.objectContaining({ key: 'che_무기_12_칠성검', rawName: '칠성검' }),
        ]);
        expect(status.buffLevels).toHaveProperty('domesticSuccessProb', 0);
        expect(fixture.findMany).toHaveBeenCalledWith({
            where: { id: { not: 7 }, npcState: { lt: 2 }, userId: { not: null } },
            select: { id: true, name: true },
            orderBy: { id: 'asc' },
        });
    });

    it.each([{}, { allItems: '{}' }])(
        'restores selectable Ref default uniques for a legacy scenario config: %j',
        async (configConst) => {
            const fixture = buildContext({ configConst });
            const status = await appRouter.createCaller(fixture.context).inherit.getStatus();

            expect(status.availableUnique.length).toBeGreaterThan(80);
            expect(status.availableUnique).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ key: 'che_무기_12_칠성검', rawName: '칠성검' }),
                    expect.objectContaining({ key: 'che_서적_07_논어', rawName: '논어' }),
                ])
            );
        }
    );

    it('loads the first inheritance-log page without an out-of-range integer cursor', async () => {
        const createdAt = new Date('2026-07-26T00:00:00Z');
        const fixture = buildContext({
            inheritanceLogs: [{ id: 2_147_483_647, year: 200, month: 4, text: '경계 로그', createdAt }],
        });

        await expect(appRouter.createCaller(fixture.context).inherit.getLogs({})).resolves.toEqual([
            { id: 2_147_483_647, year: 200, month: 4, text: '경계 로그', createdAt },
        ]);
        expect(fixture.inheritanceLogFindMany).toHaveBeenCalledWith({
            where: { userId: 'user-1' },
            orderBy: { id: 'desc' },
            take: 30,
            select: { id: true, year: true, month: true, text: true, createdAt: true },
        });
    });

    it('uses a bounded cursor for following and empty inheritance-log pages', async () => {
        const fixture = buildContext({ inheritanceLogs: [] });
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.inherit.getLogs({ lastId: 2_147_483_647 })).resolves.toEqual([]);
        expect(fixture.inheritanceLogFindMany).toHaveBeenCalledWith({
            where: { userId: 'user-1', id: { lt: 2_147_483_647 } },
            orderBy: { id: 'desc' },
            take: 30,
            select: { id: true, year: true, month: true, text: true, createdAt: true },
        });
    });

    it.each([0, -1, 1.5, 2_147_483_648])('rejects an invalid inheritance-log cursor: %s', async (lastId) => {
        const fixture = buildContext({});

        await expect(appRouter.createCaller(fixture.context).inherit.getLogs({ lastId })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
        expect(fixture.inheritanceLogFindMany).not.toHaveBeenCalled();
    });

    it('does not dispatch or charge when the authenticated user owns no general', async () => {
        const fixture = buildContext({
            auth: buildAuth('user-2'),
            general: buildGeneral({ userId: 'user-1' }),
        });

        await expect(
            appRouter.createCaller(fixture.context).inherit.buyHiddenBuff({
                type: 'domesticSuccessProb',
                level: 1,
            })
        ).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
            message: '장수가 존재하지 않습니다.',
        });
        expect(fixture.requestCommand).not.toHaveBeenCalled();
        expect(fixture.pointUpsert).not.toHaveBeenCalled();
    });

    it('mutates only the authenticated user general and inheritance balance', async () => {
        const fixture = buildContext({ inheritancePoint: 1000 });

        await expect(
            appRouter.createCaller(fixture.context).inherit.buyHiddenBuff({
                type: 'domesticSuccessProb',
                level: 1,
            })
        ).resolves.toEqual({ ok: true, remainPoint: 800 });

        expect(fixture.requestCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'patchGeneral',
                generalId: 7,
                patch: expect.objectContaining({
                    meta: expect.objectContaining({
                        inheritBuff: JSON.stringify({ domesticSuccessProb: 1 }),
                    }),
                }),
            })
        );
        expect(fixture.pointUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { userId_key: { userId: 'user-1', key: 'previous' } },
                update: { value: 800 },
            })
        );
    });

    it('queues Ref-compatible nextTurnTimeBase without moving the current scheduled turn', async () => {
        const fixture = buildContext({
            inheritancePoint: 2_000,
            general: buildGeneral({ meta: { nextTurnTimeBase: 123_456 } }),
        });
        const expected = resolveResetTurnTimeBase({
            hiddenSeed: 'test-seed',
            userId: 'user-1',
            previousTurnTimeBase: 123_456,
            tickSeconds: worldState.tickSeconds,
        });

        await expect(appRouter.createCaller(fixture.context).inherit.resetTurnTime()).resolves.toEqual({
            ok: true,
            ...expected,
        });
        expect(fixture.requestCommand).toHaveBeenCalledWith({
            type: 'patchGeneral',
            generalId: 7,
            patch: {
                meta: {
                    nextTurnTimeBase: expected.nextTurnTimeBase,
                    inheritResetTurnTime: 0,
                },
            },
        });
        expect(fixture.pointUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: 1_000 } }));
        expect(fixture.logCreate).toHaveBeenCalledWith({
            data: {
                userId: 'user-1',
                year: 200,
                month: 4,
                text: `1000 포인트로 턴 시간을 바꾸어 다다음 턴부터 ${expected.nextTurnTimeLabel} 적용`,
            },
        });
    });

    it('reveals a target owner to the caller without using the caller general id from input', async () => {
        const fixture = buildContext({ inheritancePoint: 1500 });

        await expect(
            appRouter.createCaller(fixture.context).inherit.checkOwner({ targetGeneralId: 8 })
        ).resolves.toEqual({
            ok: true,
            ownerName: '위유저',
            targetName: '조조',
        });
        expect(fixture.pointUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { userId_key: { userId: 'user-1', key: 'previous' } },
                update: { value: 500 },
            })
        );
        expect(fixture.logCreate).toHaveBeenCalledWith({
            data: {
                userId: 'user-1',
                year: 200,
                month: 4,
                text: '1000 포인트로 장수 소유자 확인',
            },
        });
        expect(fixture.requestCommand).not.toHaveBeenCalled();
    });
});
