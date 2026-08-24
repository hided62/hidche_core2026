import { describe, expect, it, vi } from 'vitest';

import { ChangeJournal } from '@sammo-ts/common';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { appRouter } from '../src/router.js';
import { resolveNationNotice, resolveNationScoutMessage } from '../src/router/nation/shared.js';

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

const buildContext = () => {
    const changeJournal = new ChangeJournal();
    const requestCommand = vi.fn(async (command: unknown) => ({
        type: 'setNationSetting',
        ok: true,
        nationId: 1,
        updatedAt: '2026-01-01T00:00:01.000Z',
        command,
    }));
    const db = {
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
        auth,
        requestId: 'http-nation-html',
        changeJournal,
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore: new RedisAccessTokenStore(redisClient, 'che:default'),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
    return { caller: appRouter.createCaller(context), requestCommand, changeJournal };
};

describe('nation HTML API boundary', () => {
    it.each([
        {
            procedure: 'setNotice',
            metaKey: 'notice',
            limit: 16_384,
        },
        {
            procedure: 'setScoutMsg',
            metaKey: 'infoText',
            limit: 1_000,
        },
    ] as const)('purifies $procedure before daemon persistence', async ({ procedure, metaKey, limit }) => {
        const fixture = buildContext();
        const dirty = `<p data-flip="x">안전</p><img src=x onerror="alert(1)"><script>alert(2)</script>`;

        const msg = '<p data-flip="x">안전</p><img src="x" alt="x" />';
        await expect(fixture.caller.nation[procedure]({ msg: dirty.slice(0, limit) })).resolves.toEqual({
            ok: true,
            msg,
        });

        expect(fixture.requestCommand).toHaveBeenCalledWith({
            type: 'setNationSetting',
            requestId: `http-nation-html:nation.${procedure}:engine:0:setNationSetting`,
            userId: 'user-1',
            generalId: 1,
            nationId: 1,
            mutation: metaKey === 'notice' ? { kind: 'notice', message: msg } : { kind: 'scoutMessage', message: msg },
        });
        expect(fixture.changeJournal.snapshot()).toEqual([]);
    });

    it.each(['setNotice', 'setScoutMsg'] as const)(
        'rejects empty and whitespace-only $procedure values like Ref required validation',
        async (procedure) => {
            for (const msg of ['', ' \t\n\v\0']) {
                const fixture = buildContext();
                await expect(fixture.caller.nation[procedure]({ msg })).rejects.toMatchObject({
                    code: 'BAD_REQUEST',
                });
                expect(fixture.requestCommand).not.toHaveBeenCalled();
            }
        }
    );

    it.each(['setNotice', 'setScoutMsg'] as const)(
        'keeps PHP trim semantics for a Unicode-only $procedure value',
        async (procedure) => {
            const fixture = buildContext();
            await expect(fixture.caller.nation[procedure]({ msg: '　' })).resolves.toMatchObject({
                ok: true,
                msg: '　',
            });
            expect(fixture.requestCommand).toHaveBeenCalledOnce();
        }
    );

    it.each([
        ['setNotice', 'notice'],
        ['setScoutMsg', 'scoutMessage'],
    ] as const)('dispatches unsafe-only $procedure HTML as the empty string Ref persists', async (procedure, kind) => {
        const fixture = buildContext();

        await expect(fixture.caller.nation[procedure]({ msg: '<script></script>' })).resolves.toEqual({
            ok: true,
            msg: '',
        });
        expect(fixture.requestCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'setNationSetting',
                mutation: { kind, message: '' },
            })
        );
    });

    it('purifies legacy stored values on every read resolver', () => {
        expect(
            resolveNationNotice({
                notice: '<strong>방침</strong><svg onload="alert(1)"></svg>',
            })
        ).toBe('<strong>방침</strong>');
        expect(
            resolveNationScoutMessage({
                infoText: '<a href="javascript:alert(1)">임관</a>',
            })
        ).toBe('<a>임관</a>');
    });
});
