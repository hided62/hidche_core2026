import { describe, expect, it, vi } from 'vitest';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';
import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import { appRouter } from '../src/router.js';

const now = new Date('2026-01-01T01:02:00Z');
const general = (overrides: Partial<GeneralRow> = {}): GeneralRow => ({
    id: 1,
    userId: 'u1',
    name: '장수',
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
    experience: 900,
    dedication: 100,
    officerLevel: 1,
    gold: 1000,
    rice: 2000,
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
const token = (userId: string): GameSessionTokenPayload => ({
    version: 1,
    profile: 'che:default',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86400000).toISOString(),
    sessionId: userId,
    user: { id: userId, username: userId, displayName: userId, roles: [] },
    sanctions: {},
});
const fixture = (generals: GeneralRow[], userId = 'u1', maxLevel?: number) => {
    const db = {
        general: {
            findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
                generals.find((g) => g.userId === where.userId)
            ),
            findMany: vi.fn(async ({ where }: { where: { nationId: number } }) =>
                generals.filter((g) => g.nationId === where.nationId)
            ),
        },
        nation: {
            findUnique: vi.fn(async () => ({
                id: 1,
                name: '위',
                color: '#080',
                level: 3,
                typeCode: 'che_중립',
                capitalCityId: 1,
                meta: { secretlimit: 3 },
            })),
        },
        city: { findMany: vi.fn(async () => [{ id: 1, name: '업' }]) },
        troop: { findMany: vi.fn(async () => [{ troopLeaderId: 2, name: '선봉대' }]) },
        worldState: {
            findFirst: vi.fn(async () => ({ config: { const: maxLevel === undefined ? {} : { maxLevel } } })),
        },
        generalTurn: {
            findMany: vi.fn(async () => [
                {
                    generalId: 1,
                    turnIdx: 0,
                    actionCode: 'che_징병',
                    arg: { crewType: 1, amount: 300 },
                },
            ]),
        },
        generalAccessLog: {
            findMany: vi.fn(async () => generals.map((g) => ({ generalId: g.id, refreshScoreTotal: g.id * 10 }))),
        },
        rankData: {
            findMany: vi.fn(async () => [
                { generalId: 1, type: 'warnum', value: 12 },
                { generalId: 1, type: 'killnum', value: 7 },
                { generalId: 1, type: 'killcrew', value: 2400 },
                { generalId: 1, type: 'deathcrew', value: 1200 },
            ]),
        },
    };
    const redis = { get: vi.fn(async () => null), set: vi.fn(async () => null) } as unknown as RedisConnector['client'];
    const context: GameApiContext = {
        db: db as unknown as DatabaseClient,
        redis,
        turnDaemon: {} as GameApiContext['turnDaemon'],
        battleSim: {} as GameApiContext['battleSim'],
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        auth: token(userId),
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore: new RedisAccessTokenStore(redis, 'che:default'),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'secret',
    };
    return { caller: appRouter.createCaller(context), db };
};

describe('nation general and secret office permissions', () => {
    it('redacts ordinary-member details and denies the secret office', async () => {
        const { caller } = fixture([general({ experience: 144_000 })]);
        const result = await caller.nation.getGeneralList();
        expect(result.viewer).toEqual({ generalId: 1, permission: 0 });
        expect(result.generals[0]).toMatchObject({
            officerLevel: 1,
            cityName: null,
            troopName: null,
            refreshScoreTotal: 10,
            dedicationLevel: 1,
            dedicationText: '30품관',
            bill: 600,
            experienceLevel: 120,
            honorText: '구세주',
            age: 20,
            killTurn: 7,
        });
        expect(result.generals[0]).not.toHaveProperty('crew');
        expect(result.generals[0]).not.toHaveProperty('reservedCommands');
        await expect(caller.nation.getSecretGeneralList()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
    it('uses the session-owned general and scopes secret rows to that nation', async () => {
        const first = general();
        const actor = general({ id: 2, userId: 'u2', officerLevel: 5, meta: { belong: 1 } });
        const ally = general({
            id: 3,
            userId: 'u3',
            gold: 3000,
            crew: 200,
            train: 80,
            atmos: 80,
            experience: 400_000,
        });
        const foreign = general({ id: 4, userId: 'u4', nationId: 2, gold: 99999 });
        const { caller, db } = fixture([first, actor, ally, foreign], 'u2');
        const result = await caller.nation.getSecretGeneralList();
        expect(result.viewer).toEqual({ generalId: 2, permission: 2 });
        expect(result.generals.map((g) => g.id)).toEqual([1, 2, 3]);
        expect(result.generals.find((entry) => entry.id === 3)?.experienceLevel).toBe(200);
        expect(result.summary).toMatchObject({ gold: 5000, crew: 800, generalCount: 3 });
        expect(result.generals[0]?.reservedCommands).toEqual([
            { action: 'che_징병', args: { crewType: 1, amount: 300 } },
        ]);
        const directory = await caller.nation.getGeneralList();
        expect(directory.generals[0]).toMatchObject({
            crewTypeName: expect.any(String),
            train: 90,
            atmos: 90,
            defenceTrain: 80,
            reservedCommands: [{ action: 'che_징병', args: { crewType: 1, amount: 300 } }],
            battleStats: { battles: 12, wins: 7, killCrew: 2400, deathCrew: 1200 },
        });
        expect(db.generalTurn.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                select: { generalId: true, turnIdx: true, actionCode: true, arg: true },
            })
        );
        expect(db.general.findFirst).toHaveBeenCalledWith({ where: { userId: 'u2' } });
        expect(db.general.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { nationId: 1 } }));
    });
    it('honors general penalties after a user switch', async () => {
        const penalized = general({ officerLevel: 5, penalty: { noChief: true } });
        const { caller } = fixture([penalized]);
        await expect(caller.nation.getSecretGeneralList()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
    it('honors an explicit Ref maxLevel override for projected experience levels', async () => {
        const actor = general({ officerLevel: 5, experience: 400_000 });
        const { caller } = fixture([actor], 'u1', 150);

        const [generalList, secretList] = await Promise.all([
            caller.nation.getGeneralList(),
            caller.nation.getSecretGeneralList(),
        ]);
        expect(generalList.generals[0]?.experienceLevel).toBe(150);
        expect(secretList.generals[0]?.experienceLevel).toBe(150);
    });
});
