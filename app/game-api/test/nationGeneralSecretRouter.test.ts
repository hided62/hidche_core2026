import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import { appRouter } from '../src/router.js';

const now = new Date('2026-01-01T01:02:00.000Z');
const buildGeneral = (overrides: Partial<GeneralRow> = {}): GeneralRow => ({
    id: 1,
    userId: 'user-1',
    name: '일반장수',
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
    experience: 900,
    dedication: 100,
    officerLevel: 1,
    gold: 1_000,
    rice: 2_000,
    crew: 300,
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
    meta: { belong: 1, defence_train: 80, killturn: 7 },
    penalty: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

const auth = (userId: string): GameSessionTokenPayload => ({
    version: 1,
    profile: 'che:default',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    sessionId: `session-${userId}`,
    user: { id: userId, username: userId, displayName: userId, roles: [] },
    sanctions: {},
});

const createContext = (options: {
    sessionUserId?: string;
    generals?: GeneralRow[];
    nationMeta?: Record<string, unknown>;
}) => {
    const sessionUserId = options.sessionUserId ?? 'user-1';
    const generals = options.generals ?? [buildGeneral()];
    const db = {
        general: {
            findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
                generals.find((general) => general.userId === where.userId)
            ),
            findMany: vi.fn(async ({ where }: { where: { nationId: number } }) =>
                generals.filter((general) => general.nationId === where.nationId)
            ),
        },
        nation: {
            findUnique: vi.fn(async () => ({
                id: 1,
                name: '위',
                color: '#008000',
                level: 3,
                typeCode: 'che_중립',
                capitalCityId: 1,
                meta: options.nationMeta ?? { secretlimit: 3 },
            })),
        },
        city: { findMany: vi.fn(async () => [{ id: 1, name: '업' }]) },
        troop: { findMany: vi.fn(async () => [{ troopLeaderId: 2, name: '선봉대' }]) },
        generalAccessLog: {
            findMany: vi.fn(async () =>
                generals.map((general) => ({
                    generalId: general.id,
                    refreshScore: general.id,
                    refreshScoreTotal: general.id * 10,
                }))
            ),
        },
        generalTurn: {
            findMany: vi.fn(async () => [
                { generalId: 1, turnIdx: 0, actionCode: '징병' },
                { generalId: 1, turnIdx: 1, actionCode: '훈련' },
            ]),
        },
    };
    const redis = { get: vi.fn(async () => null), set: vi.fn(async () => null) } as unknown as RedisConnector['client'];
    return {
        context: {
            db: db as unknown as DatabaseClient,
            redis,
            turnDaemon: {} as GameApiContext['turnDaemon'],
            battleSim: {} as GameApiContext['battleSim'],
            profile: { id: 'che', scenario: 'default', name: 'che:default' },
            auth: auth(sessionUserId),
            uploadDir: 'uploads',
            uploadPath: '/uploads',
            uploadPublicUrl: null,
            accessTokenStore: new RedisAccessTokenStore(redis, 'che:default'),
            flushStore: new InMemoryFlushStore(),
            gameTokenSecret: 'test-secret',
        } satisfies GameApiContext,
        db,
    };
};

describe('nation general and secret-office permissions', () => {
    it('redacts confidential columns for an ordinary member and denies the secret office', async () => {
        const fixture = createContext({});
        const caller = appRouter.createCaller(fixture.context);

        const list = await caller.nation.getGeneralList();
        expect(list.viewer).toEqual({ generalId: 1, permission: 0 });
        expect(list.generals[0]).toMatchObject({
            officerLevel: 1,
            gold: 1_000,
            rice: 2_000,
            detail: null,
        });
        expect(fixture.db.generalTurn.findMany).not.toHaveBeenCalled();
        await expect(caller.nation.getSecretGeneralList()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('allows a tenured member, scopes rows to the actor nation, and returns legacy summary and turns', async () => {
        const me = buildGeneral({ meta: { belong: 3, defence_train: 90, killturn: 7 } });
        const ally = buildGeneral({
            id: 2,
            userId: 'user-2',
            name: '아군',
            troopId: 2,
            gold: 3_000,
            rice: 4_000,
            crew: 200,
            train: 80,
            atmos: 80,
        });
        const hiddenNpc = buildGeneral({ id: 3, userId: null, name: '가상', npcState: 5, gold: 99_999 });
        const foreign = buildGeneral({ id: 4, userId: 'foreign', nationId: 2, gold: 88_888 });
        const fixture = createContext({ generals: [me, ally, hiddenNpc, foreign] });

        const result = await appRouter.createCaller(fixture.context).nation.getSecretGeneralList();
        expect(result.viewer.permission).toBe(1);
        expect(result.generals.map((general) => general.id)).toEqual([1, 2, 3]);
        expect(result.generals[0]?.detail).toMatchObject({
            cityName: '업',
            defenceTrain: 90,
            killTurn: 7,
            reservedCommands: ['징병', '훈련'],
        });
        expect(result.generals[1]?.detail?.troopName).toBe('선봉대');
        expect(result.summary).toMatchObject({
            gold: 4_000,
            rice: 6_000,
            crew: 500,
            generalCount: 2,
            readiness: {
                90: { crew: 300, generals: 1 },
                80: { crew: 500, generals: 2 },
                60: { crew: 500, generals: 2 },
            },
        });
        expect(fixture.db.general.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { nationId: 1 } })
        );
    });

    it('derives the acting general from the authenticated user and applies that general permission', async () => {
        const first = buildGeneral({ userId: 'user-1', meta: { belong: 1 } });
        const second = buildGeneral({ id: 2, userId: 'user-2', officerLevel: 5, meta: { belong: 1 } });
        const fixture = createContext({ sessionUserId: 'user-2', generals: [first, second] });

        const result = await appRouter.createCaller(fixture.context).nation.getSecretGeneralList();
        expect(result.viewer).toEqual({ generalId: 2, permission: 2 });
        expect(fixture.db.general.findFirst).toHaveBeenCalledWith({ where: { userId: 'user-2' } });
    });

    it('keeps penalty-based secret denial even for an otherwise qualified general', async () => {
        const me = buildGeneral({ officerLevel: 5, penalty: { noChief: true } });
        const fixture = createContext({ generals: [me] });
        await expect(appRouter.createCaller(fixture.context).nation.getSecretGeneralList()).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
    });
});
