import { describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';

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
    name: '정책담당',
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
    officerLevel: 12,
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
    meta: { belong: 5, permission: 'normal' },
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

const baseNation = {
    id: 1,
    name: '위',
    level: 3,
    tech: 3_000,
    meta: {
        _updatedAt: '2026-01-01T00:00:00.000Z',
        npc_nation_policy: {
            values: { reqNationRice: 456 },
            priority: ['천도', '천도'],
        },
        npc_general_policy: {
            priority: ['출병', '일반내정', '출병'],
        },
    },
};

const baseWorld = {
    config: {
        stat: { max: 80, npcMax: 75 },
        environment: { unitSet: 'basic' },
        const: { develCost: 100 },
    },
    meta: {
        npc_nation_policy: { values: { reqNationGold: 123 } },
        npc_general_policy: {},
    },
};

const createContext = (
    options: {
        me?: GeneralRow;
        nation?: typeof baseNation;
        world?: {
            config: typeof baseWorld.config;
            meta: Record<string, unknown>;
            currentYear?: number;
            currentMonth?: number;
        };
        requestCommand?: ReturnType<typeof vi.fn>;
        troopRows?: Array<{ troopLeaderId: number }>;
        cityRows?: Array<{ id: number }>;
        historyRows?: Array<Record<string, unknown>>;
    } = {}
): { context: GameApiContext; findFirst: ReturnType<typeof vi.fn>; requestCommand: ReturnType<typeof vi.fn> } => {
    const requestCommand =
        options.requestCommand ??
        vi.fn(async () => ({
            type: 'setNpcPolicy',
            ok: true,
            nationId: 1,
            updatedAt: '2026-01-01T00:01:00.000Z',
        }));
    const findFirst = vi.fn(async () => options.me ?? baseGeneral);
    const db = {
        general: { findFirst },
        nation: { findUnique: vi.fn(async () => options.nation ?? baseNation) },
        worldState: { findFirst: vi.fn(async () => options.world ?? baseWorld) },
        troop: { findMany: vi.fn(async () => options.troopRows ?? [{ troopLeaderId: 101 }]) },
        city: { findMany: vi.fn(async () => options.cityRows ?? [{ id: 1 }, { id: 2 }]) },
        playAuditPolicy: {
            findMany: vi.fn(async () => options.historyRows ?? []),
            findFirst: vi.fn(async () => options.historyRows?.[0] ?? null),
        },
        $transaction: async <T>(read: (tx: object) => Promise<T>): Promise<T> => read(db),
    };
    const redisClient = { get: async () => null, set: async () => null };
    return {
        context: {
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
        },
        findFirst,
        requestCommand,
    };
};

describe('NPC policy router', () => {
    const historyRow = {
        id: 'a'.repeat(64),
        schemaVersion: 1,
        nationId: 1,
        area: 'NPC_NATION_PRIORITY',
        revision: 2,
        previousId: 'b'.repeat(64),
        source: 'CHANGE',
        year: 185,
        month: 1,
        createdAt: new Date('2026-01-01Z'),
        actor: {
            userId: 'private-user',
            generalId: 22,
            name: '정책담당',
            nationId: 1,
            officerLevel: 12,
            npcState: 0,
            permission: 4,
        },
        before: { priority: ['NPC전방발령', 'NPC포상'] },
        after: { priority: ['NPC포상'] },
    };
    const historyContext = (options: Parameters<typeof createContext>[0] = {}) =>
        createContext({
            ...options,
            world: {
                ...baseWorld,
                currentYear: 185,
                currentMonth: 1,
                meta: { ...baseWorld.meta, serverId: 'current-season' },
            },
            historyRows: options.historyRows ?? [historyRow],
        });

    it('lets an ordinary nation reader inspect the actor and changes without admin request/account fields', async () => {
        const fixture = historyContext({ me: { ...baseGeneral, officerLevel: 2 } });
        const caller = appRouter.createCaller(fixture.context);
        const page = await caller.npc.policyHistory({ area: 'NPC_NATION_PRIORITY', limit: 1 });
        expect(page.items[0]).toMatchObject({ actor: { name: '정책담당' }, revision: 2 });
        const detail = await caller.npc.policyVersion({ id: historyRow.id });
        expect(detail.fields).toEqual([
            { key: 'priority', beforeJson: '["NPC전방발령","NPC포상"]', afterJson: '["NPC포상"]', changed: true },
        ]);
        expect(JSON.stringify(detail)).not.toMatch(/private-user|permission|requestId|inputSequence/);
    });

    it.each([
        { nationId: 0 },
        { officerLevel: 0 },
        { officerLevel: 1, meta: { belong: 0 } },
        { penalty: { noChief: true } },
    ])('denies history when current nation read permission is missing: %j', async (patch) => {
        const fixture = historyContext({ me: { ...baseGeneral, ...patch } });
        await expect(
            appRouter.createCaller(fixture.context).npc.policyHistory({ area: 'NPC_VALUES' })
        ).rejects.toBeDefined();
    });

    it('scopes cursor and version lookups to the authenticated nation and current season', async () => {
        const fixture = historyContext();
        const caller = appRouter.createCaller(fixture.context);
        await caller.npc.policyHistory({ area: 'NPC_VALUES', cursor: 7, limit: 1 });
        const tx = await fixture.context.db.$transaction!(async (db) => db);
        expect(tx.playAuditPolicy.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { serverId: 'current-season', nationId: 1, area: 'NPC_VALUES', revision: { lt: 7 } },
                take: 2,
            })
        );
        await caller.npc.policyVersion({ id: historyRow.id });
        expect(tx.playAuditPolicy.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    id: historyRow.id,
                    serverId: 'current-season',
                    nationId: 1,
                    area: { in: ['NPC_VALUES', 'NPC_NATION_PRIORITY', 'NPC_GENERAL_PRIORITY'] },
                },
            })
        );
        await expect(caller.npc.policyHistory({ area: 'NPC_VALUES', limit: 51 })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
        await expect(caller.npc.policyVersion({ id: 'bad' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('requires authentication and rejects caller-supplied nation or defence history over HTTP', async () => {
        const fixture = historyContext();
        const app = fastify();
        await app.register(fastifyTRPCPlugin, {
            prefix: '/che/api/trpc',
            trpcOptions: {
                router: appRouter,
                createContext: ({ req }: { req: { headers: Record<string, string | string[] | undefined> } }) => ({
                    ...fixture.context,
                    auth: req.headers['x-session-token'] === 'fixture-session' ? auth : null,
                }),
            },
        });
        try {
            const query = (input: object, authenticated = true) =>
                app.inject({
                    url: `/che/api/trpc/npc.policyHistory?input=${encodeURIComponent(JSON.stringify(input))}`,
                    headers: authenticated ? { 'x-session-token': 'fixture-session' } : {},
                });
            expect((await query({ area: 'NPC_VALUES' }, false)).statusCode).toBe(401);
            expect((await query({ area: 'NPC_VALUES' })).statusCode).toBe(200);
            expect((await query({ area: 'DEFENCE' })).statusCode).toBe(400);
            expect((await query({ area: 'NPC_VALUES', nationId: 2 })).statusCode).toBe(400);
        } finally {
            await app.close();
        }
    });

    it('denies sanctioned sessions before reading history', async () => {
        const fixture = historyContext();
        fixture.context.auth = { ...auth, sanctions: { suspendedUntil: '2999-01-01T00:00:00Z' } };
        await expect(
            appRouter.createCaller(fixture.context).npc.policyHistory({ area: 'NPC_VALUES' })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(fixture.findFirst).not.toHaveBeenCalled();
    });

    it('paginates revisions without exposing a missing or unavailable version', async () => {
        const fixture = historyContext({ historyRows: [historyRow, { ...historyRow, revision: 1 }] });
        const page = await appRouter
            .createCaller(fixture.context)
            .npc.policyHistory({ area: 'NPC_NATION_PRIORITY', limit: 1 });
        expect(page.items).toHaveLength(1);
        expect(page.nextCursor).toBe(2);
        const missing = historyContext({ historyRows: [] });
        await expect(
            appRouter.createCaller(missing.context).npc.policyVersion({ id: historyRow.id })
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        const noIdentity = createContext();
        await expect(
            appRouter.createCaller(noIdentity.context).npc.policyHistory({ area: 'NPC_VALUES' })
        ).resolves.toMatchObject({ coverage: 'IDENTITY_MISSING', items: [], nextCursor: null });
    });
    it('loads server and nation overrides while calculating legacy zero-value hints from nation tech', async () => {
        const fixture = createContext();
        const result = await appRouter.createCaller(fixture.context).npc.getPolicy();

        expect(fixture.findFirst).toHaveBeenCalledWith({ where: { userId: 'user-22' } });
        expect(result.currentNationPolicy).toMatchObject({ reqNationGold: 123, reqNationRice: 456 });
        expect(result.currentNationPriority).toEqual(['천도', '천도']);
        expect(result.currentGeneralActionPriority).toEqual(['출병', '일반내정', '출병']);
        expect(result.zeroPolicy).toMatchObject({
            reqNationGold: 10_000,
            reqNationRice: 12_000,
            reqNPCDevelGold: 3_000,
            reqNPCWarGold: 3_900,
            reqNPCWarRice: 3_900,
            reqHumanWarUrgentGold: 6_300,
            reqHumanWarUrgentRice: 6_300,
            reqHumanWarRecommandGold: 12_600,
            reqHumanWarRecommandRice: 12_600,
        });
    });

    it('uses the live world development cost instead of the scenario snapshot', async () => {
        const fixture = createContext({
            world: {
                ...baseWorld,
                config: { ...baseWorld.config, const: { develCost: 100 } },
                meta: { ...baseWorld.meta, develcost: 42 } as typeof baseWorld.meta & { develcost: number },
            },
        });

        const result = await appRouter.createCaller(fixture.context).npc.getPolicy();

        expect(result.zeroPolicy.reqNPCDevelGold).toBe(1_260);
    });

    it('lets a secret-level reader load the page while mapping authoritative ENGINE rejection', async () => {
        const reader = { ...baseGeneral, officerLevel: 2 };
        const requestCommand = vi.fn(async () => ({
            type: 'setNpcPolicy' as const,
            ok: false as const,
            code: 'FORBIDDEN' as const,
            reason: '권한이 부족합니다.',
            nationId: 1,
        }));
        const fixture = createContext({ me: reader, requestCommand });
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.npc.getPolicy()).resolves.toMatchObject({ permissionLevel: 1 });
        await expect(caller.npc.setNationPriority(['천도'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(fixture.requestCommand).toHaveBeenCalledOnce();
    });

    it.each([
        ['군주', { ...baseGeneral, officerLevel: 12 }],
        ['감찰권자', { ...baseGeneral, officerLevel: 1, meta: { belong: 0, permission: 'auditor' } }],
        ['외교권자', { ...baseGeneral, officerLevel: 1, meta: { belong: 0, permission: 'ambassador' } }],
    ])('%s dispatches actor-bound policy intent to the daemon', async (_label, me) => {
        const fixture = createContext({ me });
        await expect(appRouter.createCaller(fixture.context).npc.setNationPriority(['천도', '천도'])).resolves.toEqual({
            ok: true,
        });
        expect(fixture.requestCommand).toHaveBeenCalledWith({
            type: 'setNpcPolicy',
            userId: 'user-22',
            generalId: 22,
            nationId: 1,
            expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
            mutation: { kind: 'nationPriority', priority: ['천도', '천도'] },
        });
    });

    it('forwards raw policy intent so ENGINE can validate current troop and city state atomically', async () => {
        const fixture = createContext();
        const caller = appRouter.createCaller(fixture.context);

        await caller.npc.setNationPolicy({
            reqNationGold: -100,
            safeRecruitCityPopulationRatio: -0.5,
            CombatForce: { 101: [1, 2] },
        });
        expect(fixture.requestCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'setNpcPolicy',
                mutation: {
                    kind: 'nationPolicy',
                    values: {
                        reqNationGold: -100,
                        safeRecruitCityPopulationRatio: -0.5,
                        CombatForce: { 101: [1, 2] },
                    },
                },
            })
        );
    });

    it('preserves duplicate priority entries in the dispatched intent', async () => {
        const fixture = createContext();
        const caller = appRouter.createCaller(fixture.context);

        await caller.npc.setGeneralPriority(['출병', '출병', '일반내정']);
        expect(fixture.requestCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                mutation: { kind: 'generalPriority', priority: ['출병', '출병', '일반내정'] },
            })
        );
    });

    it('blocks nationless, penalized, and stale writers without changing lifecycle state directly', async () => {
        const nationless = createContext({ me: { ...baseGeneral, nationId: 0, officerLevel: 0 } });
        await expect(appRouter.createCaller(nationless.context).npc.getPolicy()).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
        });

        const penalized = createContext({ me: { ...baseGeneral, penalty: { noChief: true } } });
        await expect(appRouter.createCaller(penalized.context).npc.getPolicy()).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });

        const staleCommand = vi.fn(async () => ({
            type: 'setNpcPolicy',
            ok: false,
            code: 'CONFLICT',
            nationId: 1,
            reason: '다른 사용자가 정책을 변경했습니다.',
        }));
        const stale = createContext({ requestCommand: staleCommand });
        await expect(appRouter.createCaller(stale.context).npc.setNationPriority(['천도'])).rejects.toMatchObject({
            code: 'CONFLICT',
        });
    });
});
