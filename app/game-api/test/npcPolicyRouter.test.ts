import { describe, expect, it, vi } from 'vitest';

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
        world?: typeof baseWorld;
        requestCommand?: ReturnType<typeof vi.fn>;
        troopRows?: Array<{ troopLeaderId: number }>;
        cityRows?: Array<{ id: number }>;
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
