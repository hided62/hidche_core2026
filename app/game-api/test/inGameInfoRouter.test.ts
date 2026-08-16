import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import { appRouter } from '../src/router.js';

const now = new Date('2026-01-01T00:00:00Z');
const general = (overrides: Partial<GeneralRow> = {}): GeneralRow => ({
    id: 1,
    userId: 'user-1',
    name: '아군',
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
    strength: 60,
    intel: 50,
    injury: 0,
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    gold: 1000,
    rice: 1000,
    crew: 500,
    crewTypeId: 1,
    train: 90,
    atmos: 90,
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
    meta: { defence_train: 80 },
    penalty: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
});
const auth = (roles: string[] = [], userId = 'user-1'): GameSessionTokenPayload => ({
    version: 1,
    profile: 'che:default',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86400000).toISOString(),
    sessionId: 'session',
    user: { id: userId, username: 'tester', displayName: 'Tester', roles },
    sanctions: {},
});
const city = (id: number, nationId: number) => ({
    id,
    name: `도시${id}`,
    level: 6,
    nationId,
    supplyState: 1,
    frontState: 0,
    population: 1000,
    populationMax: 2000,
    agriculture: 10,
    agricultureMax: 20,
    commerce: 11,
    commerceMax: 21,
    security: 12,
    securityMax: 22,
    trust: 50,
    trade: 100,
    defence: 13,
    defenceMax: 23,
    wall: 14,
    wallMax: 24,
    region: 2,
    conflict: {},
    meta: {},
});

const context = (
    options: {
        me?: GeneralRow;
        roles?: string[];
        userId?: string;
        nationMeta?: Record<string, unknown>;
        nationLevel?: number;
        stationCityId?: number;
    } = {}
) => {
    const me = options.me ?? general();
    const cities = [city(1, 1), city(2, 2), city(3, 2), city(80, 1)];
    const foreign = general({ id: 2, userId: 'user-2', name: '적군', nationId: 2, cityId: 2, crew: 777 });
    const db = {
        general: {
            findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
                where.userId === me.userId ? me : null
            ),
            findUnique: vi.fn(async ({ where }: { where: { id: number } }) => (where.id === me.id ? me : null)),
            findMany: vi.fn(async (args: { where?: Record<string, unknown>; select?: Record<string, boolean> }) => {
                if (args.where?.nationId === 1 && args.select?.cityId)
                    return [
                        { cityId: me.cityId },
                        ...(options.stationCityId ? [{ cityId: options.stationCityId }] : []),
                    ];
                if (args.where?.cityId === 2) return [foreign];
                if (args.where?.cityId === 3) return [foreign];
                if (args.where?.officerLevel) return [];
                return [];
            }),
        },
        nation: {
            findUnique: vi.fn(async () => ({
                id: 1,
                name: '아국',
                color: '#008000',
                level: options.nationLevel ?? 1,
                capitalCityId: 1,
                meta: options.nationMeta ?? {},
            })),
            findMany: vi.fn(async () => [
                {
                    id: 1,
                    name: '아국',
                    color: '#008000',
                    level: 1,
                    capitalCityId: 1,
                    meta: { power: 100, gennum: 4 },
                },
                {
                    id: 2,
                    name: '적국',
                    color: '#800000',
                    level: 1,
                    capitalCityId: 2,
                    meta: { power: 90, gennum: 3 },
                },
            ]),
        },
        city: { findMany: vi.fn(async () => cities) },
        worldState: {
            findFirst: vi.fn(async () => ({
                currentYear: 200,
                currentMonth: 1,
                config: { startYear: 180 },
                meta: { turntime: '2026-01-01' },
            })),
        },
        generalTurn: { findMany: vi.fn(async () => []) },
        diplomacy: { findMany: vi.fn(async () => []) },
        $queryRaw: vi
            .fn()
            .mockResolvedValueOnce([{ coverageVersion: 0, revision: null }])
            .mockResolvedValueOnce(
                cities.map((item) => ({
                    id: item.id,
                    level: item.level,
                    nationId: item.nationId,
                    region: item.region,
                    supplyState: item.supplyState,
                    meta: item.meta,
                }))
            )
            .mockResolvedValueOnce([
                { id: 1, name: '아국', color: '#008000', capitalCityId: 1, meta: {} },
                { id: 2, name: '적국', color: '#800000', capitalCityId: 2, meta: {} },
            ])
            .mockResolvedValueOnce([{ cityId: me.cityId }]),
    };
    const redis = { get: vi.fn(async () => null), set: vi.fn(async () => null) } as unknown as RedisConnector['client'];
    const accessTokenStore = new RedisAccessTokenStore(redis, 'che:default');
    return {
        db: db as unknown as DatabaseClient,
        redis,
        turnDaemon: {} as GameApiContext['turnDaemon'],
        battleSim: {} as GameApiContext['battleSim'],
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        auth: auth(options.roles, options.userId),
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore,
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'secret',
    } satisfies GameApiContext;
};

describe('in-game information permissions', () => {
    it('returns the ref nation summary fields in descending power order', async () => {
        const result = await appRouter.createCaller(context()).world.getGlobalInfo();

        expect(result.nations).toEqual([
            expect.objectContaining({ id: 1, name: '아국', power: 100, generalCount: 4, cities: ['도시1', '도시80'] }),
            expect.objectContaining({ id: 2, name: '적국', power: 90, generalCount: 3, cities: ['도시2', '도시3'] }),
        ]);
    });

    it('does not expose nation-only pages to a wandering general', async () => {
        const caller = appRouter.createCaller(context({ me: general({ nationId: 0, officerLevel: 0 }) }));
        await expect(caller.nation.getNationInfo()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
        await expect(caller.nation.getCityOverview()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    });

    it('lets a wandering general select only the current city', async () => {
        const caller = appRouter.createCaller(context({ me: general({ nationId: 0, officerLevel: 0 }) }));
        const result = await caller.world.getCurrentCity({ cityId: 2 });
        expect(result.city.id).toBe(2);
        expect(result.options.map((entry) => entry.id)).toEqual([1]);
        expect(result.visibility.full).toBe(false);
        expect(result.city.population).toBeNull();
        expect(result.generals).toEqual([]);
    });

    it('derives the actor from the session user instead of accepting another user general', async () => {
        const caller = appRouter.createCaller(context({ userId: 'user-2' }));
        await expect(caller.world.getCurrentCity({ cityId: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('allows a nation member to select a city occupied by another general of the same nation', async () => {
        const result = await appRouter.createCaller(context({ stationCityId: 2 })).world.getCurrentCity({ cityId: 2 });
        expect(result.options.map((entry) => entry.id)).toContain(2);
        expect(result.visibility.full).toBe(true);
    });

    it('does not grant a spy city while the nation has no active level', async () => {
        const result = await appRouter
            .createCaller(context({ nationMeta: { spy: { 2: 2 } }, nationLevel: 0 }))
            .world.getCurrentCity({ cityId: 2 });
        expect(result.options.map((entry) => entry.id)).not.toContain(2);
        expect(result.visibility.full).toBe(false);
    });

    it('keeps adjacent foreign detail redacted and never reveals military fields', async () => {
        const result = await appRouter
            .createCaller(context({ me: general({ cityId: 80 }) }))
            .world.getCurrentCity({ cityId: 2 });
        expect(result.visibility).toEqual({ full: false, detailed: true });
        expect(result.city.agriculture).toBeNull();
        expect(result.city.defence).toBeNull();
        expect(result.generals[0]).toMatchObject({ crew: null, train: null, atmos: null, crewTypeId: null });
    });

    it('allows a spied city in full but still redacts foreign-general private details', async () => {
        const result = await appRouter
            .createCaller(context({ nationMeta: { spy: { 2: 2 } } }))
            .world.getCurrentCity({ cityId: 2 });
        expect(result.visibility.full).toBe(true);
        expect(result.city.population).toBe(1000);
        expect(result.generals[0]).toMatchObject({ crew: 777, train: null, atmos: null, crewTypeId: null });
        expect(result.forceSummary).toMatchObject({
            enemyCrew: 777,
            enemyArmedGenerals: 1,
            enemyGenerals: 1,
        });
    });

    it.each(['admin', 'superuser', 'admin.superuser'])(
        'allows the %s role to inspect all city and general fields',
        async (role) => {
            const result = await appRouter.createCaller(context({ roles: [role] })).world.getCurrentCity({ cityId: 3 });
            expect(result.options).toHaveLength(4);
            expect(result.visibility.full).toBe(true);
            expect(result.generals[0]).toMatchObject({ crew: 777, train: 90, atmos: 90, crewTypeId: 1 });
        }
    );
});
