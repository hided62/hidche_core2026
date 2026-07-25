import { describe, expect, it, vi } from 'vitest';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { appRouter } from '../src/router.js';

const general: GeneralRow = {
    id: 1,
    userId: 'user-1',
    name: '정책담당',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    npcState: 0,
    affinity: null,
    bornYear: 180,
    deadYear: 300,
    picture: null,
    imageServer: 0,
    leadership: 50,
    strength: 50,
    intel: 50,
    injury: 0,
    experience: 0,
    dedication: 0,
    officerLevel: 5,
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
    meta: {},
    penalty: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
    sessionId: 'session-1',
    user: {
        id: 'user-1',
        username: 'tester',
        displayName: 'Tester',
        roles: [],
    },
    sanctions: {},
};

const buildContext = (blockChangeScout: boolean) => {
    const requestCommand = vi.fn();
    const db = {
        general: {
            findFirst: vi.fn(async () => general),
        },
        nation: {
            findUnique: vi.fn(async () => ({ meta: {} })),
        },
        worldState: {
            findFirst: vi.fn(async () => ({ meta: { block_change_scout: blockChangeScout } })),
        },
    };
    const redisClient = {
        get: async () => null,
        set: async () => null,
    };
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
        accessTokenStore: new RedisAccessTokenStore(redisClient, 'che:default'),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
    return { context, requestCommand };
};

describe('nation scout policy lock', () => {
    it('rejects policy changes before daemon dispatch while the scenario lock is enabled', async () => {
        const fixture = buildContext(true);
        await expect(appRouter.createCaller(fixture.context).nation.setBlockScout({ value: false })).rejects.toMatchObject(
            {
                code: 'FORBIDDEN',
                message: '임관 설정을 바꿀 수 없도록 설정되어 있습니다.',
            }
        );
        expect(fixture.requestCommand).not.toHaveBeenCalled();
    });
});
