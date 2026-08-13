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
    city?: Record<string, unknown> | null;
    targets?: GeneralRow[];
    nationMeta?: Record<string, unknown>;
    requestCommand?: ReturnType<typeof vi.fn>;
    accessToken?: string;
    logs?: Array<{ id: number; text: string; year?: number; month?: number; createdAt?: Date }>;
    troopName?: string | null;
    troopLeaderAction?: string | null;
    refreshScore?: number;
    refreshScoreTotal?: number;
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
            aggregate: vi.fn(async () => ({
                _count: targets.filter((general) => general.nationId === (me?.nationId ?? 0)).length,
                _sum: {
                    crew: targets.reduce((sum, general) => sum + general.crew, 0),
                    leadership: targets.reduce((sum, general) => sum + general.leadership, 0),
                },
            })),
            update: vi.fn(),
        },
        troop: {
            findUnique: vi.fn(async () =>
                options.troopName === undefined ? null : options.troopName === null ? null : { name: options.troopName }
            ),
        },
        generalTurn: {
            findFirst: vi.fn(async () =>
                options.troopLeaderAction === undefined || options.troopLeaderAction === null
                    ? null
                    : { actionCode: options.troopLeaderAction }
            ),
        },
        generalAccessLog: {
            findUnique: vi.fn(async () => ({
                refreshScore: options.refreshScore ?? 0,
                refreshScoreTotal: options.refreshScoreTotal ?? 0,
            })),
        },
        city: {
            findUnique: vi.fn(async () => options.city ?? null),
            aggregate: vi.fn(async () => ({
                _count: options.city ? 1 : 0,
                _sum: {
                    population: Number(options.city?.population ?? 0),
                    populationMax: Number(options.city?.populationMax ?? 0),
                },
            })),
        },
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
                config: { const: { upgradeLimit: 20 } },
            })),
        },
        logEntry: {
            groupBy: vi.fn(async () => []),
            findMany: vi.fn(
                async (query?: {
                    where?: { id?: { lt?: number } };
                    take?: number;
                    select?: { id?: boolean; text?: boolean };
                }) => {
                    const source = (options.logs ?? [{ id: 1, text: '기록' }]).map((entry) => ({
                        year: 185,
                        month: 1,
                        createdAt: now,
                        ...entry,
                    }));
                    const beforeId = query?.where?.id?.lt;
                    const filtered = beforeId ? source.filter((entry) => entry.id < beforeId) : source;
                    const selected = query?.select ? filtered.map(({ id, text }) => ({ id, text })) : filtered;
                    return query?.take ? selected.slice(0, query.take) : selected;
                }
            ),
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
    it('returns every ref progress-bar input from the owned general and current city read model', async () => {
        const fixture = createContext({
            me: buildGeneral({
                meta: {
                    explevel: 4,
                    dedlevel: 3,
                    leadership_exp: 7,
                    strength_exp: 8,
                    intel_exp: 9,
                    dex1: 350,
                    dex2: 1_375,
                    dex3: 3_500,
                    dex4: 7_125,
                    dex5: 12_650,
                },
            }),
            city: {
                id: 1,
                name: '계',
                level: 5,
                nationId: 1,
                population: 322_886,
                populationMax: 388_500,
                agriculture: 6_911,
                agricultureMax: 7_500,
                commerce: 7_451,
                commerceMax: 8_000,
                security: 5_792,
                securityMax: 6_000,
                trust: 72,
                trade: 101,
                defence: 7_529,
                defenceMax: 7_800,
                wall: 7_819,
                wallMax: 8_100,
                region: 1,
                supplyState: 1,
                frontState: 0,
            },
        });

        await expect(appRouter.createCaller(fixture.context).general.me()).resolves.toMatchObject({
            general: {
                progression: {
                    experienceLevel: 4,
                    dedicationLevel: 3,
                    statExperience: { leadership: 7, strength: 8, intelligence: 9 },
                    statUpgradeLimit: 20,
                    dex: [350, 1_375, 3_500, 7_125, 12_650],
                },
            },
            city: {
                population: 322_886,
                populationMax: 388_500,
                agriculture: 6_911,
                agricultureMax: 7_500,
                commerce: 7_451,
                commerceMax: 8_000,
                security: 5_792,
                securityMax: 6_000,
                trust: 72,
                trade: 101,
                defence: 7_529,
                defenceMax: 7_800,
                wall: 7_819,
                wallMax: 8_100,
            },
        });
        expect(fixture.db.city.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({
                select: expect.objectContaining({
                    populationMax: true,
                    agricultureMax: true,
                    commerceMax: true,
                    securityMax: true,
                    trust: true,
                    trade: true,
                    defenceMax: true,
                    wallMax: true,
                }),
            })
        );
    });

    it('returns Ref display names instead of numeric levels and internal codes for the main GUI', async () => {
        const fixture = createContext({
            me: buildGeneral({
                officerLevel: 9,
                crewTypeId: 1100,
                horseCode: 'che_명마_03_노새',
                meta: { explevel: 4, dedlevel: 2 },
            }),
            city: {
                id: 1,
                name: '업',
                level: 8,
                nationId: 1,
                population: 1_000,
                populationMax: 2_000,
                agriculture: 100,
                agricultureMax: 200,
                commerce: 100,
                commerceMax: 200,
                security: 100,
                securityMax: 200,
                trust: 70,
                trade: 100,
                defence: 100,
                defenceMax: 200,
                wall: 100,
                wallMax: 200,
                region: 2,
                supplyState: 1,
                frontState: 0,
            },
        });

        await expect(appRouter.createCaller(fixture.context).general.me()).resolves.toMatchObject({
            general: {
                officerLevelText: '간의대부',
                crewTypeName: '보병',
                progression: { experienceLevel: 4, dedicationLevel: 2, dedicationText: '29품관' },
                itemNames: { horse: '노새(+3)' },
            },
            city: { levelName: '특', regionName: '중원', nationName: '위' },
            nation: {
                levelName: '주자사',
                typeName: '법가',
                capitalCityName: '업',
            },
        });
    });

    it('returns the Ref general-card title, execution, troop, and refresh-score projection', async () => {
        const fixture = createContext({
            me: buildGeneral({
                troopId: 7,
                officerLevel: 4,
                strength: 70,
                intel: 40,
                turnTime: new Date('2026-01-01T00:07:06.000Z'),
                meta: { officerCity: 1, killturn: 6, defence_train: 80 },
            }),
            city: {
                id: 1,
                name: '업',
                level: 8,
                nationId: 1,
                population: 1_000,
                populationMax: 2_000,
                agriculture: 100,
                agricultureMax: 200,
                commerce: 100,
                commerceMax: 200,
                security: 100,
                securityMax: 200,
                trust: 70,
                trade: 100,
                defence: 100,
                defenceMax: 200,
                wall: 100,
                wallMax: 200,
                region: 2,
                supplyState: 1,
                frontState: 0,
            },
            troopName: '정밀검증부대',
            troopLeaderAction: '휴식',
            refreshScore: 3,
            refreshScoreTotal: 1_141,
        });

        await expect(appRouter.createCaller(fixture.context).general.me()).resolves.toMatchObject({
            general: {
                officerCityName: '업',
                generalType: '용장',
                leadershipBonus: 0,
                retirementYear: 70,
                defenceTrain: 80,
                killTurn: 6,
                remainingMinutes: null,
                troop: { name: '정밀검증부대', status: 'inactive', leaderCityName: '업' },
                refreshScore: { current: 3, total: 1_141, text: '열심' },
            },
        });
    });

    it('returns the Ref-style neutral nation frame and trait display names on the main read model', async () => {
        const fixture = createContext({
            me: buildGeneral({
                nationId: 0,
                officerLevel: 0,
                personalCode: 'che_안전',
                specialCode: 'che_상재',
                special2Code: 'che_신산',
            }),
        });

        await expect(appRouter.createCaller(fixture.context).general.me()).resolves.toMatchObject({
            general: {
                traits: {
                    personal: '안전',
                    specialDomestic: '상재',
                    specialWar: '신산',
                },
            },
            nation: {
                id: 0,
                name: '재야',
                color: '#000000',
                level: 0,
                gold: 0,
                rice: 0,
                tech: 0,
                typeCode: 'None',
                capitalCityId: null,
            },
        });
        expect(fixture.db.nation.findUnique).not.toHaveBeenCalled();
    });

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
                where: { scope: 'SYSTEM', category: { in: ['SUMMARY', 'ACTION'] }, id: { gte: 0 } },
                orderBy: { id: 'desc' },
                take: 16,
                select: { id: true, text: true, createdAt: true },
            })
        );
        expect(fixture.db.logEntry.findMany).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                where: { scope: 'GENERAL', category: 'ACTION', generalId: 7, id: { gte: 0 } },
                orderBy: { id: 'desc' },
                take: 16,
                select: { id: true, text: true, createdAt: true },
            })
        );
        expect(fixture.db.logEntry.findMany).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({
                where: { scope: 'SYSTEM', category: 'HISTORY', id: { gte: 0 } },
                orderBy: { id: 'desc' },
                take: 16,
                select: { id: true, text: true, createdAt: true },
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
            generals: [
                {
                    id: 7,
                    picture: 'default.jpg',
                    imageServer: 0,
                    officerLevelText: '일반',
                    crewTypeName: '-',
                    equipmentNames: { weapon: '-', book: '-', horse: '-', item: '-' },
                    traits: { personal: '-', specialDomestic: '-', specialWar: '-' },
                    progression: {
                        experienceLevel: 0,
                        dedicationLevel: 1,
                        dedicationText: '30품관',
                        statExperience: { leadership: 0, strength: 0, intelligence: 0 },
                        statUpgradeLimit: 20,
                        dex: [0, 0, 0, 0, 0],
                    },
                    battleStats: { kills: 0, deaths: 0, fire: 0, killCrew: 0, deathCrew: 0, dex: [0, 0, 0, 0, 0] },
                },
            ],
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
            logs: [{ id: 1, year: 185, month: 1, createdAt: '2026-01-01 00:00:00' }],
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
