import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { appRouter } from '../src/router.js';

const general: GeneralRow = {
    id: 71,
    userId: 'authenticated-user',
    name: '국가설정담당',
    nationId: 3,
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
    sessionId: 'session-setting',
    user: {
        id: 'authenticated-user',
        username: 'tester',
        displayName: 'Tester',
        roles: [],
    },
    sanctions: {},
};

const buildContext = (authenticated = true) => {
    const requestCommand = vi.fn(async (command: unknown) => {
        const kind = (command as { mutation?: { kind?: string } }).mutation?.kind;
        return {
            type: 'setNationSetting' as const,
            ok: true as const,
            nationId: 3,
            updatedAt: '2026-01-01T00:00:01.000Z',
            ...(kind === 'blockWar' ? { availableCnt: 7 } : {}),
        };
    });
    const transaction = vi.fn(async () => {
        throw new Error('nation settings must not use an API input-event transaction');
    });
    const db = {
        $transaction: transaction,
        general: {
            findFirst: vi.fn(async () => general),
        },
        nation: {
            findUnique: vi.fn(async () => ({ meta: {} })),
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
        auth: authenticated ? auth : null,
        requestId: 'http-setting-boundary',
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore: new RedisAccessTokenStore(redisClient, 'che:default'),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
    return { context, requestCommand, transaction };
};

describe('nation setting router engine boundary', () => {
    it('binds all semantic setting commands to the authenticated actor and a stable request id', async () => {
        const fixture = buildContext();
        const caller = appRouter.createCaller(fixture.context);

        await expect(caller.nation.setNotice({ msg: '<strong>방침</strong>' })).resolves.toEqual({
            ok: true,
            msg: '<strong>방침</strong>',
        });
        await expect(caller.nation.setScoutMsg({ msg: '<em>등용문</em>' })).resolves.toEqual({
            ok: true,
            msg: '<em>등용문</em>',
        });
        await expect(caller.nation.setRate({ amount: 30 })).resolves.toEqual({ ok: true });
        await expect(caller.nation.setBill({ amount: 200 })).resolves.toEqual({ ok: true });
        await expect(caller.nation.setSecretLimit({ amount: 99 })).resolves.toEqual({ ok: true });
        await expect(caller.nation.setBlockWar({ value: false })).resolves.toEqual({ availableCnt: 7 });
        await expect(caller.nation.setBlockScout({ value: true })).resolves.toEqual({ ok: true });

        expect(fixture.requestCommand.mock.calls.map(([command]) => command)).toEqual([
            {
                type: 'setNationSetting',
                requestId: 'http-setting-boundary:nation.setNotice:engine:0:setNationSetting',
                userId: 'authenticated-user',
                generalId: 71,
                nationId: 3,
                mutation: { kind: 'notice', message: '<strong>방침</strong>' },
            },
            {
                type: 'setNationSetting',
                requestId: 'http-setting-boundary:nation.setScoutMsg:engine:0:setNationSetting',
                userId: 'authenticated-user',
                generalId: 71,
                nationId: 3,
                mutation: { kind: 'scoutMessage', message: '<em>등용문</em>' },
            },
            {
                type: 'setNationSetting',
                requestId: 'http-setting-boundary:nation.setRate:engine:0:setNationSetting',
                userId: 'authenticated-user',
                generalId: 71,
                nationId: 3,
                mutation: { kind: 'rate', amount: 30 },
            },
            {
                type: 'setNationSetting',
                requestId: 'http-setting-boundary:nation.setBill:engine:0:setNationSetting',
                userId: 'authenticated-user',
                generalId: 71,
                nationId: 3,
                mutation: { kind: 'bill', amount: 200 },
            },
            {
                type: 'setNationSetting',
                requestId: 'http-setting-boundary:nation.setSecretLimit:engine:0:setNationSetting',
                userId: 'authenticated-user',
                generalId: 71,
                nationId: 3,
                mutation: { kind: 'secretLimit', amount: 99 },
            },
            {
                type: 'setNationSetting',
                requestId: 'http-setting-boundary:nation.setBlockWar:engine:0:setNationSetting',
                userId: 'authenticated-user',
                generalId: 71,
                nationId: 3,
                mutation: { kind: 'blockWar', value: false },
            },
            {
                type: 'setNationSetting',
                requestId: 'http-setting-boundary:nation.setBlockScout:engine:0:setNationSetting',
                userId: 'authenticated-user',
                generalId: 71,
                nationId: 3,
                mutation: { kind: 'blockScout', value: true },
            },
        ]);
        expect(fixture.transaction).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated calls before querying or dispatching a setting command', async () => {
        const fixture = buildContext(false);

        await expect(appRouter.createCaller(fixture.context).nation.setBill({ amount: 20 })).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
        expect(fixture.context.db.general.findFirst).not.toHaveBeenCalled();
        expect(fixture.requestCommand).not.toHaveBeenCalled();
        expect(fixture.transaction).not.toHaveBeenCalled();
    });
});
