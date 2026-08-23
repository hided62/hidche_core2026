import { describe, expect, it, vi } from 'vitest';

import { ChangeJournal } from '@sammo-ts/common';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';
import type { MessagePayload } from '@sammo-ts/logic';

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

interface CapturedMessage {
    mailbox: number;
    type: string;
    src: number;
    dest: number;
    payload: MessagePayload;
}

const buildContext = (options: {
    auth?: GameSessionTokenPayload | null;
    general?: GeneralRow | null;
    target?: GeneralRow | null;
    inheritancePoint?: number;
    inheritanceRows?: Array<{ key: string; value: number }>;
    rankRows?: Array<{ type: string; value: number }>;
    inheritanceLogs?: Array<{ id: number; year: number; month: number; text: string; createdAt: Date }>;
    configConst?: Record<string, unknown>;
    configMap?: Record<string, unknown>;
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
    const webPushOutboxCreateMany = vi.fn(async () => ({ count: 1 }));
    const activeWorldState =
        options.configConst === undefined && options.configMap === undefined
            ? worldState
            : {
                  ...worldState,
                  config: {
                      ...worldState.config,
                      ...(options.configConst === undefined ? {} : { const: options.configConst }),
                      ...(options.configMap === undefined ? {} : { map: options.configMap }),
                  },
              };
    const messageRows: CapturedMessage[] = [];
    const queryRaw = vi.fn(async (query: unknown, ...values: unknown[]) => {
        const queryStrings = Array.isArray(query)
            ? query.map(String)
            : ((query as { strings?: readonly string[] } | null)?.strings ?? []);
        const sql = queryStrings.join(' ');
        if (sql.includes('INSERT INTO message')) {
            const payload = JSON.parse(String(values[8])) as MessagePayload;
            messageRows.push({
                mailbox: Number(values[0]),
                type: String(values[1]),
                src: Number(values[2]),
                dest: Number(values[3]),
                payload,
            });
            return [{ id: 100 + messageRows.length }];
        }
        if (sql.includes('FROM inheritance_point')) {
            return [{ value: options.inheritancePoint ?? 10_000 }];
        }
        throw new Error(`Unexpected raw query in inherit router fixture: ${sql}`);
    });
    const db = {
        $queryRaw: queryRaw,
        worldState: {
            findFirst: vi.fn(async () => activeWorldState),
        },
        general: {
            findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
                general?.userId === where.userId ? general : null
            ),
            findMany,
            findUnique: vi.fn(async ({ where }: { where: { id: number } }) => {
                if (target?.id === where.id) return target;
                if (general?.id === where.id) return general;
                return null;
            }),
        },
        nation: {
            findUnique: vi.fn(async ({ where }: { where: { id: number } }) =>
                where.id === 1 ? { id: 1, name: '촉', color: '#ff0000' } : null
            ),
        },
        inheritancePoint: {
            upsert: pointUpsert,
            findMany: vi.fn(
                async () => options.inheritanceRows ?? [{ key: 'previous', value: options.inheritancePoint ?? 10_000 }]
            ),
        },
        rankData: {
            findMany: vi.fn(async () => options.rankRows ?? []),
        },
        inheritanceLog: {
            create: logCreate,
            findMany: inheritanceLogFindMany,
        },
        inheritanceUserState: {
            findUnique: vi.fn(async () => null),
            upsert: vi.fn(async () => ({})),
        },
        webPushOutbox: {
            createMany: webPushOutboxCreateMany,
        },
    };
    const accessTokenStore = new RedisAccessTokenStore(
        {
            get: async () => null,
            set: async () => null,
        },
        'che:default'
    );
    const changeJournal = new ChangeJournal();
    const context: GameApiContext = {
        db: db as unknown as DatabaseClient,
        changeJournal,
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
    return {
        context,
        requestCommand,
        pointUpsert,
        logCreate,
        findMany,
        inheritanceLogFindMany,
        messageRows,
        webPushOutboxCreateMany,
        changeJournal,
    };
};

describe('inherit router actor and permission boundaries', () => {
    it('rejects unauthenticated status and mutations', async () => {
        const fixture = buildContext({ auth: null });
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.inherit.getStatus()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        await expect(caller.inherit.buyHiddenBuff({ type: 'warAvoidRatio', level: 1 })).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
        await expect(caller.inherit.checkOwner({ targetGeneralId: 8 })).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
        expect(fixture.messageRows).toHaveLength(0);
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

    it('reports and enforces the Ref S100 stat-reset ban without dispatching or charging', async () => {
        const fixture = buildContext({
            configMap: { targetGeneralPool: 'SPoolUnderU100' },
            inheritancePoint: 0,
        });
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.inherit.getStatus()).resolves.toMatchObject({ canResetStat: false });
        await expect(
            caller.inherit.resetStat({
                leadership: 70,
                strength: 45,
                intel: 85,
                inheritBonusStat: [2, 1, 1],
            })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '100기 올스타 장수는 능력치 초기화를 사용할 수 없습니다.',
        });
        expect(fixture.requestCommand).not.toHaveBeenCalled();
        expect(fixture.pointUpsert).not.toHaveBeenCalled();
        expect(fixture.logCreate).not.toHaveBeenCalled();
    });

    it('projects every Ref inheritance source with its own coefficient and stored/calculated boundary', async () => {
        const fixture = buildContext({
            general: buildGeneral({
                meta: {
                    inherit_lived_month: 12,
                    max_domestic_critical: 20,
                    inherit_active_action: 0.5,
                    belong: 7,
                    max_belong: 9,
                    rank_warnum: 300,
                    firenum: 200,
                    dex1: 1_275_978,
                    dex2: 100,
                    event100_allstar: { granted: { dex2: 40 } },
                    betwin: 200,
                    betgold: 200_000,
                    betwingold: 100_000,
                },
            }),
            rankRows: [
                { type: 'warnum', value: 3 },
                { type: 'firenum', value: 2 },
                { type: 'betwin', value: 2 },
                { type: 'betgold', value: 2_000 },
                { type: 'betwingold', value: 1_000 },
            ],
            inheritanceRows: [
                { key: 'previous', value: 100 },
                { key: 'max_domestic_critical', value: 80 },
                { key: 'unifier', value: 250 },
                { key: 'tournament', value: 50 },
            ],
        });

        const status = await appRouter.createCaller(fixture.context).inherit.getStatus();

        expect(status.items).toEqual({
            previous: 100,
            lived_month: 12,
            max_domestic_critical: 80,
            active_action: 1.5,
            unifier: 250,
            tournament: 50,
            max_belong: 90,
            combat: 15,
            sabotage: 40,
            dex: 1_276.036,
            betting: 5,
        });
        expect(status.totalPoint).toBeCloseTo(1_919.536, 8);
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

    it('orders unique auction candidates by Ref slot order and preserves order within each slot', async () => {
        const fixture = buildContext({
            configConst: {
                allItems: {
                    item: { che_보물_도기: 1 },
                    book: { che_서적_07_논어: 1 },
                    weapon: { che_무기_12_칠성검: 1 },
                    horse: {
                        che_명마_07_백마: 1,
                        che_명마_07_기주마: 1,
                    },
                },
            },
        });

        const status = await appRouter.createCaller(fixture.context).inherit.getStatus();

        expect(status.availableUnique.map(({ key, slot }) => ({ key, slot }))).toEqual([
            { key: 'che_명마_07_백마', slot: 'horse' },
            { key: 'che_명마_07_기주마', slot: 'horse' },
            { key: 'che_무기_12_칠성검', slot: 'weapon' },
            { key: 'che_서적_07_논어', slot: 'book' },
            { key: 'che_보물_도기', slot: 'item' },
        ]);
    });

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

    it('reserves the selected Ref war trait and charges the authenticated owner once', async () => {
        const fixture = buildContext({
            inheritancePoint: 5_000,
            configConst: { availableSpecialWar: ['che_의술'] },
        });

        await expect(
            appRouter.createCaller(fixture.context).inherit.setNextSpecialWar({ specialKey: 'che_의술' })
        ).resolves.toEqual({ ok: true });

        expect(fixture.requestCommand).toHaveBeenCalledWith({
            type: 'patchGeneral',
            generalId: 7,
            patch: { meta: { inheritSpecificSpecialWar: 'che_의술' } },
        });
        expect(fixture.pointUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: 1_000 } }));
        expect(fixture.logCreate).toHaveBeenCalledWith({
            data: {
                userId: 'user-1',
                year: 200,
                month: 4,
                text: '4000 포인트로 다음 전투 특기로 의술 지정',
            },
        });
    });

    it('does not dispatch or charge when a different war trait is already reserved', async () => {
        const fixture = buildContext({
            inheritancePoint: 5_000,
            general: buildGeneral({ meta: { inheritSpecificSpecialWar: 'che_신산' } }),
            configConst: { availableSpecialWar: ['che_의술'] },
        });

        await expect(
            appRouter.createCaller(fixture.context).inherit.setNextSpecialWar({ specialKey: 'che_의술' })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: '이미 예약한 특기가 있습니다.' });
        expect(fixture.requestCommand).not.toHaveBeenCalled();
        expect(fixture.pointUpsert).not.toHaveBeenCalled();
        expect(fixture.logCreate).not.toHaveBeenCalled();
    });

    it('resets the current war trait to the in-memory null sentinel and preserves Ref history as an array', async () => {
        const fixture = buildContext({
            inheritancePoint: 2_000,
            general: buildGeneral({ meta: { prev_types_special2: ['che_돌격'], marker: 3 } }),
        });

        await expect(appRouter.createCaller(fixture.context).inherit.resetSpecialWar()).resolves.toEqual({ ok: true });

        expect(fixture.requestCommand).toHaveBeenCalledWith({
            type: 'patchGeneral',
            generalId: 7,
            patch: {
                specialWar: null,
                meta: {
                    prev_types_special2: ['che_돌격', 'che_선봉'],
                    marker: 3,
                    inheritResetSpecialWar: 0,
                },
            },
        });
        expect(fixture.pointUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: 1_000 } }));
        expect(fixture.logCreate).toHaveBeenCalledWith({
            data: {
                userId: 'user-1',
                year: 200,
                month: 4,
                text: '1000 포인트로 전투 특기 초기화',
            },
        });
    });

    it('does not dispatch or charge when the current war trait is already blank', async () => {
        const fixture = buildContext({ inheritancePoint: 2_000, general: buildGeneral({ special2Code: 'None' }) });

        await expect(appRouter.createCaller(fixture.context).inherit.resetSpecialWar()).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '이미 전투 특기가 공란입니다.',
        });
        expect(fixture.requestCommand).not.toHaveBeenCalled();
        expect(fixture.pointUpsert).not.toHaveBeenCalled();
        expect(fixture.logCreate).not.toHaveBeenCalled();
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
        expect(fixture.messageRows).toHaveLength(2);
        expect(fixture.messageRows).toEqual([
            expect.objectContaining({
                mailbox: 7,
                type: 'private',
                src: 0,
                dest: 7,
                payload: expect.objectContaining({
                    src: expect.objectContaining({ generalId: 0, nationName: 'System' }),
                    dest: expect.objectContaining({ generalId: 7, generalName: '유비' }),
                    text: '조조의 소유자는 위유저 입니다.',
                }),
            }),
            expect.objectContaining({
                mailbox: 8,
                type: 'private',
                src: 0,
                dest: 8,
                payload: expect.objectContaining({
                    src: expect.objectContaining({ generalId: 0, nationName: 'System' }),
                    dest: expect.objectContaining({ generalId: 8, generalName: '조조' }),
                    text: '소유자명이 누군가에 의해 확인되었습니다.',
                }),
            }),
        ]);
        expect(fixture.webPushOutboxCreateMany).toHaveBeenNthCalledWith(1, {
            data: [{ eventId: 'message:101', eventType: 'PRIVATE_MESSAGE_RECEIVED', userIds: ['user-1'] }],
            skipDuplicates: true,
        });
        expect(fixture.webPushOutboxCreateMany).toHaveBeenNthCalledWith(2, {
            data: [{ eventId: 'message:102', eventType: 'PRIVATE_MESSAGE_RECEIVED', userIds: ['user-2'] }],
            skipDuplicates: true,
        });
        expect(fixture.changeJournal.snapshot()).toEqual([
            { domain: 'messages.mailbox', entityId: 7 },
            { domain: 'messages.mailbox', entityId: 8 },
        ]);
        expect(fixture.requestCommand).not.toHaveBeenCalled();
    });

    it('does not charge or send messages when the owner lookup target is the actor', async () => {
        const fixture = buildContext({
            inheritancePoint: 1_500,
            target: buildGeneral({ id: 7, userId: 'user-1', name: '유비' }),
        });

        await expect(
            appRouter.createCaller(fixture.context).inherit.checkOwner({ targetGeneralId: 7 })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '자신의 정보는 확인할 수 없습니다.',
        });
        expect(fixture.pointUpsert).not.toHaveBeenCalled();
        expect(fixture.logCreate).not.toHaveBeenCalled();
        expect(fixture.messageRows).toHaveLength(0);
        expect(fixture.changeJournal.snapshot()).toEqual([]);
    });

    it('does not charge or send messages when inheritance points are insufficient', async () => {
        const fixture = buildContext({ inheritancePoint: 999 });

        await expect(
            appRouter.createCaller(fixture.context).inherit.checkOwner({ targetGeneralId: 8 })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '유산 포인트가 부족합니다.',
        });
        expect(fixture.pointUpsert).not.toHaveBeenCalled();
        expect(fixture.logCreate).not.toHaveBeenCalled();
        expect(fixture.messageRows).toHaveLength(0);
        expect(fixture.changeJournal.snapshot()).toEqual([]);
    });
});
