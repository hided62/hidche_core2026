import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import { appRouter } from '../src/router.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const actor = (overrides: Partial<GeneralRow> = {}): GeneralRow => ({
    id: 1,
    userId: 'user-1',
    name: '조회자',
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
    experience: 0,
    dedication: 0,
    officerLevel: 1,
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
    turnTime: now,
    recentWarTime: null,
    age: 20,
    startAge: 20,
    personalCode: 'None',
    specialCode: 'None',
    special2Code: 'None',
    lastTurn: {},
    meta: {},
    penalty: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

const auth = (userId = 'user-1', roles: string[] = []): GameSessionTokenPayload => ({
    version: 1,
    profile: 'che:default',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    sessionId: `session-${userId}`,
    user: { id: userId, username: userId, displayName: userId, roles },
    sanctions: {},
});

const nationRows = [
    {
        id: 1,
        name: '위',
        color: '#008000',
        capitalCityId: 1,
        chiefGeneralId: 10,
        gold: 0,
        rice: 0,
        tech: 0,
        level: 3,
        typeCode: 'None',
        meta: { power: 1_000 },
    },
    {
        id: 2,
        name: '촉',
        color: '#800000',
        capitalCityId: 2,
        chiefGeneralId: 20,
        gold: 0,
        rice: 0,
        tech: 0,
        level: 2,
        typeCode: 'None',
        meta: { power: 2_000 },
    },
];

const directoryGeneral = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    name: '조회자',
    userId: 'user-1',
    picture: 'default.jpg',
    imageServer: 0,
    npcState: 0,
    age: 20,
    nationId: 1,
    cityId: 1,
    dedication: 100,
    officerLevel: 1,
    personalCode: 'None',
    specialCode: 'None',
    special2Code: 'None',
    injury: 0,
    leadership: 70,
    strength: 60,
    intel: 50,
    crew: 100,
    experience: 1_000,
    meta: { killturn: 3 },
    penalty: {},
    ...overrides,
});

const globalGenerals = [
    directoryGeneral({
        id: 10,
        name: '군주',
        dedication: 900,
        officerLevel: 12,
        leadership: 80,
        strength: 80,
        intel: 80,
        meta: { killturn: 4, owner_name: '통일유저' },
        experience: 10_000,
    }),
    directoryGeneral({
        id: 11,
        name: '외교관',
        dedication: 800,
        officerLevel: 1,
        leadership: 70,
        strength: 80,
        intel: 40,
        meta: { killturn: 2, permission: 'ambassador' },
        experience: 5_000,
    }),
    directoryGeneral({
        id: 12,
        name: '제재외교관',
        dedication: 700,
        officerLevel: 1,
        leadership: 70,
        strength: 40,
        intel: 80,
        meta: { killturn: 1, permission: 'ambassador' },
        penalty: { noTopSecret: true },
        experience: 2_000,
    }),
    directoryGeneral({
        id: 13,
        name: '조언자',
        dedication: 600,
        officerLevel: 1,
        leadership: 30,
        strength: 70,
        intel: 70,
        meta: { killturn: 5, permission: 'auditor' },
        experience: 1_000,
    }),
    directoryGeneral({
        id: 20,
        name: '촉장',
        userId: 'user-2',
        nationId: 2,
        cityId: 2,
        dedication: 500,
        officerLevel: 12,
        leadership: 80,
        strength: 70,
        intel: 65,
        meta: { killturn: 0 },
        experience: 20_000,
    }),
    directoryGeneral({
        id: 30,
        name: '재야장',
        userId: 'user-3',
        nationId: 0,
        cityId: 3,
        dedication: 400,
        officerLevel: 0,
        npcState: 2,
        meta: { killturn: 9 },
        experience: 500,
    }),
];

const createContext = (
    options: {
        auth?: GameSessionTokenPayload | null;
        me?: GeneralRow | null;
        isUnited?: number;
        directory?: {
            nations: typeof nationRows;
            generals: typeof globalGenerals;
            cities: Array<{ id: number; name: string; nationId: number }>;
        };
    } = {}
): { context: GameApiContext; requestCommand: ReturnType<typeof vi.fn> } => {
    const token = options.auth === undefined ? auth() : options.auth;
    const me = options.me === undefined ? actor({ userId: token?.user.id ?? 'user-1' }) : options.me;
    const requestCommand = vi.fn();
    const redis = { get: vi.fn(async () => null), set: vi.fn(async () => null) } as unknown as RedisConnector['client'];
    const db = {
        general: {
            findFirst: vi.fn(async () => me),
            findMany: vi.fn(async () => options.directory?.generals ?? globalGenerals),
        },
        nation: {
            findMany: vi.fn(async () => options.directory?.nations ?? nationRows),
        },
        city: {
            findMany: vi.fn(
                async () =>
                    options.directory?.cities ?? [
                        { id: 1, name: '허창', nationId: 1 },
                        { id: 2, name: '성도', nationId: 2 },
                        { id: 3, name: '낙양', nationId: 0 },
                    ]
            ),
        },
        generalAccessLog: {
            findMany: vi.fn(async () => [
                { generalId: 10, refreshScoreTotal: 104 },
                { generalId: 20, refreshScoreTotal: 206 },
            ]),
        },
        worldState: {
            findFirst: vi.fn(async () => ({
                config: { const: { maxLevel: 100, maxDedLevel: 30 } },
                meta: {
                    isUnited: options.isUnited ?? 0,
                    killturn: 4,
                    autorun_user: { limit_minutes: 60 },
                },
                tickSeconds: 3_600,
            })),
        },
    };
    const context: GameApiContext = {
        db: db as unknown as DatabaseClient,
        redis,
        turnDaemon: { requestCommand } as unknown as GameApiContext['turnDaemon'],
        battleSim: {} as GameApiContext['battleSim'],
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        auth: token,
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore: new RedisAccessTokenStore(redis, 'che:default'),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'secret',
    };
    return { context, requestCommand };
};

describe('legacy global nation/general directories', () => {
    it('requires an authenticated user who owns an in-game general', async () => {
        const unauthenticated = appRouter.createCaller(createContext({ auth: null, me: null }).context);
        await expect(unauthenticated.world.getNationDirectory()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        await expect(unauthenticated.world.getGeneralDirectory()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

        const noGeneral = appRouter.createCaller(createContext({ me: null }).context);
        await expect(noGeneral.world.getNationDirectory()).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(noGeneral.world.getGeneralDirectory()).rejects.toMatchObject({ code: 'NOT_FOUND' });

        const adminWithoutGeneral = appRouter.createCaller(
            createContext({ auth: auth('admin', ['admin']), me: null }).context
        );
        await expect(adminWithoutGeneral.world.getNationDirectory()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('keeps hover-safe public rows identical for wandering, ordinary, chief, and possessed actors', async () => {
        const viewers = [
            actor({ nationId: 0, officerLevel: 0 }),
            actor({ nationId: 1, officerLevel: 1 }),
            actor({ nationId: 1, officerLevel: 12 }),
            actor({ nationId: 1, officerLevel: 1, npcState: 1 }),
        ];
        const results = await Promise.all(
            viewers.map(async (me) => {
                const { context, requestCommand } = createContext({ me });
                const caller = appRouter.createCaller(context);
                const result = {
                    nations: await caller.world.getNationDirectory(),
                    generals: await caller.world.getGeneralDirectory({ sort: 2 }),
                };
                expect(requestCommand).not.toHaveBeenCalled();
                return result;
            })
        );
        expect(results.slice(1)).toEqual([results[0], results[0], results[0]]);
        for (const result of results) {
            const serializedNationRows = JSON.stringify(result.nations);
            for (const privateField of [
                'totalCrew',
                'crew',
                'leadership',
                'strength',
                'intel',
                'killturn',
                'refreshScoreTotal',
                'meta',
                'penalty',
            ]) {
                expect(serializedNationRows).not.toContain(`"${privateField}"`);
            }
            const serializedGeneralRows = JSON.stringify(result.generals);
            for (const privateField of [
                'userId',
                'meta',
                'penalty',
                'gold',
                'rice',
                'crew',
                'train',
                'atmos',
                'turnTime',
                'lastTurn',
            ]) {
                expect(serializedGeneralRows).not.toContain(`"${privateField}"`);
            }
        }
    });

    it('preserves power/dedication order, synthesizes neutral, and applies target-general permission penalties', async () => {
        const result = await appRouter.createCaller(createContext().context).world.getNationDirectory();
        expect(result.map((nation) => nation.id)).toEqual([2, 1, 0]);
        expect(result[1]).toMatchObject({
            id: 1,
            generalCount: 4,
            cityCount: 1,
            forceEstimate: {
                totalGeneralCount: 4,
                userCombatGeneralCount: 1,
                userTroops: 8_000,
                npcCombatGeneralCount: 0,
                npcTroops: 0,
                inactiveGeneralCount: 2,
            },
            ambassadorNames: ['군주', '외교관'],
            auditorCount: 1,
        });
        expect(result[1]?.generalGroups.map((group) => [group.label, group.generals.map(({ name }) => name)])).toEqual([
            ['만능장', ['군주']],
            ['무장', ['외교관']],
            ['지장', ['제재외교관']],
            ['무지장', ['조언자']],
        ]);
        expect(result[1]?.generals.map((general) => general.name)).toEqual(['군주', '외교관', '제재외교관', '조언자']);
        expect(result[1]?.officers[0]).toMatchObject({
            officerLevel: 12,
            general: { id: 10, name: '군주' },
        });
        expect(result[2]).toMatchObject({ name: '재 야', generalCount: 1, cityCount: 1 });
        expect(JSON.stringify(result)).not.toContain('totalCrew');
    });

    it('matches every Ref general-category boundary and estimates only combat-capable groups', async () => {
        const categoryStats = [
            ['만능장', 80, 80, 80],
            ['통장', 70, 20, 20],
            ['무장', 70, 80, 40],
            ['지장', 70, 40, 80],
            ['평범장', 60, 50, 50],
            ['무지장', 30, 50, 50],
            ['무능장', 30, 10, 10],
        ] as const;
        const categoryGenerals = categoryStats.map(([name, leadership, strength, intel], index) =>
            directoryGeneral({
                id: 101 + index,
                name,
                nationId: 1,
                leadership,
                strength,
                intel,
                meta: { killturn: 4 },
            })
        );
        const [nation] = await appRouter
            .createCaller(
                createContext({
                    directory: {
                        nations: [nationRows[0]!],
                        generals: categoryGenerals,
                        cities: [{ id: 1, name: '허창', nationId: 1 }],
                    },
                }).context
            )
            .world.getNationDirectory();

        expect(nation?.generalGroups.map((group) => group.label)).toEqual(categoryStats.map(([name]) => name));
        expect(nation?.forceEstimate).toEqual({
            totalGeneralCount: 7,
            userCombatGeneralCount: 5,
            userTroops: 35_000,
            npcCombatGeneralCount: 0,
            npcTroops: 0,
            inactiveGeneralCount: 0,
        });
    });

    it('projects a level-zero nation location from its ruler city even when that city belongs to another nation', async () => {
        const roamingNation = {
            ...nationRows[0]!,
            id: 3,
            name: '방랑군',
            capitalCityId: 0,
            chiefGeneralId: 40,
            level: 0,
            meta: { power: 500 },
        };
        const roamingRuler = directoryGeneral({
            id: 40,
            name: '방랑군주',
            nationId: 3,
            cityId: 2,
            officerLevel: 12,
        });
        const result = await appRouter
            .createCaller(
                createContext({
                    directory: {
                        nations: [roamingNation],
                        generals: [roamingRuler],
                        cities: [{ id: 2, name: '성도', nationId: 2 }],
                    },
                }).context
            )
            .world.getNationDirectory();

        expect(result[0]).toMatchObject({
            id: 3,
            level: 0,
            cityCount: 0,
            rulerCityName: '성도',
        });
    });

    it('implements all legacy sort boundaries and never exposes user ids or raw metadata', async () => {
        const caller = appRouter.createCaller(createContext().context);
        const defaultResult = await caller.world.getGeneralDirectory();
        expect(defaultResult.sort).toBe(9);
        expect(defaultResult.generals.slice(0, 2).map((general) => general.id)).toEqual([20, 10]);

        const killturnResult = await caller.world.getGeneralDirectory({ sort: 8 });
        expect(killturnResult.generals.slice(0, 3).map((general) => general.id)).toEqual([20, 12, 11]);
        const npcResult = await caller.world.getGeneralDirectory({ sort: 15 });
        expect(npcResult.generals[0]?.id).toBe(30);

        const serialized = JSON.stringify(defaultResult);
        expect(serialized).not.toContain('user-');
        expect(serialized).not.toContain('"meta"');
        expect(serialized).not.toContain('"penalty"');
        expect(defaultResult.generals.find((general) => general.id === 10)?.ownerName).toBeNull();
    });

    it.each([1, 2, 3])('reveals only the legacy owner display name in united state %i', async (isUnited) => {
        const result = await appRouter
            .createCaller(createContext({ isUnited }).context)
            .world.getGeneralDirectory({ sort: 1 });
        expect(result.generals.find((general) => general.id === 10)?.ownerName).toBe('통일유저');
        expect(JSON.stringify(result)).not.toContain('user-1');
    });
});
