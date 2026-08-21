import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import { appRouter } from '../src/router.js';

vi.mock('../src/maps/mapLayout.js', () => ({
    loadMapLayout: vi.fn(async () => ({
        mapName: 'che',
        cityList: [{ id: 1, name: '업', level: 8, region: 1, x: 0, y: 0, path: [] }],
        regionMap: { 1: '하북' },
        levelMap: { 8: '특' },
    })),
}));

vi.mock('@sammo-ts/game-engine/scenario/unitSetLoader.js', () => ({
    loadUnitSetDefinitionByName: vi.fn(async () => ({ crewTypes: [{ id: 1, name: '보병' }] })),
}));

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
    meta: { defence_train: 80 },
    penalty: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

const token = (): GameSessionTokenPayload => ({
    version: 1,
    profile: 'che:default',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    sessionId: 'session-1',
    user: { id: 'u1', username: 'u1', displayName: '장수', roles: [] },
    sanctions: {},
});

const fixture = (authenticated = true) => {
    const actor = general();
    const npc = general({ id: 2, userId: null, name: 'NPC', npcState: 2 });
    const city = {
        id: 1,
        name: '업',
        nationId: 1,
        level: 8,
        region: 1,
        population: 150_000,
        populationMax: 620_500,
        agriculture: 1_000,
        agricultureMax: 12_500,
        commerce: 1_000,
        commerceMax: 11_300,
        security: 1_000,
        securityMax: 10_000,
        trust: 80,
        trade: 100,
        defence: 5_000,
        defenceMax: 11_700,
        wall: 5_000,
        wallMax: 12_200,
    };
    const db = {
        general: {
            findFirst: vi.fn(async () => actor),
            findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
                if ('cityId' in where) return [actor, npc];
                if ('officerLevel' in where) return [];
                if ('nationId' in where) return [actor, npc];
                return [];
            }),
        },
        nation: {
            findUnique: vi.fn(async () => ({ id: 1, name: '위', color: '#008000', level: 1, meta: {} })),
            findMany: vi.fn(async () => [{ id: 1, name: '위', color: '#008000', level: 1, meta: {} }]),
        },
        city: { findMany: vi.fn(async () => [city]) },
        worldState: {
            findFirst: vi.fn(async () => ({ config: {}, meta: { turntime: '2026-01-01 10:02:00' } })),
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
    };
    const redis = { get: vi.fn(async () => null), set: vi.fn(async () => null) } as unknown as RedisConnector['client'];
    const context: GameApiContext = {
        db: db as unknown as DatabaseClient,
        redis,
        turnDaemon: {} as GameApiContext['turnDaemon'],
        battleSim: {} as GameApiContext['battleSim'],
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        auth: authenticated ? token() : null,
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore: new RedisAccessTokenStore(redis, 'che:default'),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'secret',
    };
    return { caller: appRouter.createCaller(context), db };
};

describe('world current-city command projection', () => {
    it('returns the first five own-user turns as canonical action and args while redacting NPC turns', async () => {
        const { caller, db } = fixture();

        const result = await caller.world.getCurrentCity();

        expect(result.generals.find((entry) => entry.id === 1)?.turns).toEqual([
            { action: 'che_징병', args: { crewType: 1, amount: 300 } },
        ]);
        expect(result.generals.find((entry) => entry.id === 2)?.turns).toEqual([]);
        expect(db.generalTurn.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { generalId: { in: [1] }, turnIdx: { lt: 5 } },
                select: { generalId: true, turnIdx: true, actionCode: true, arg: true },
            })
        );
    });

    it('keeps authentication and input validation in front of the city read model', async () => {
        await expect(fixture(false).caller.world.getCurrentCity()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        await expect(fixture().caller.world.getCurrentCity({ cityId: 0 })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
    });
});
