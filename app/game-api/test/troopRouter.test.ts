import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { appRouter } from '../src/router.js';

const buildGeneral = (overrides: Partial<GeneralRow> = {}): GeneralRow => ({
    id: 1,
    userId: 'user-1',
    name: '부대장',
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
    officerLevel: 1,
    gold: 1000,
    rice: 1000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    weaponCode: 'None',
    bookCode: 'None',
    horseCode: 'None',
    itemCode: 'None',
    turnTime: new Date('2026-01-01T00:00:00Z'),
    recentWarTime: null,
    age: 20,
    startAge: 20,
    personalCode: 'None',
    specialCode: 'None',
    special2Code: 'None',
    lastTurn: {},
    meta: {},
    penalty: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
});

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

const buildContext = (options: {
    me?: GeneralRow;
    target?: GeneralRow | null;
    troop?: { troopLeaderId: number; nationId: number; name: string } | null;
    nationMeta?: Record<string, unknown>;
    auth?: GameSessionTokenPayload | null;
    result: Awaited<ReturnType<TurnDaemonTransport['requestCommand']>>;
}) => {
    const me = options.me ?? buildGeneral();
    const requestCommand = vi.fn(async () => options.result);
    const db = {
        general: {
            findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
                me.userId === where.userId ? me : null
            ),
            findUnique: vi.fn(async ({ where }: { where: { id: number } }) => {
                if (where.id === me.id) {
                    return me;
                }
                return options.target?.id === where.id ? options.target : null;
            }),
        },
        nation: {
            findUnique: vi.fn(async ({ where }: { where: { id: number } }) =>
                where.id === me.nationId ? { id: me.nationId, meta: options.nationMeta ?? {} } : null
            ),
        },
        troop: {
            findUnique: vi.fn(async ({ where }: { where: { troopLeaderId: number } }) =>
                options.troop?.troopLeaderId === where.troopLeaderId ? options.troop : null
            ),
        },
    };
    const accessTokenStore = new RedisAccessTokenStore(
        {
            get: async () => null,
            set: async () => null,
        },
        'che:default'
    );
    const context: GameApiContext = {
        db: db as unknown as DatabaseClient,
        redis: {} as RedisConnector['client'],
        turnDaemon: { requestCommand } as unknown as TurnDaemonTransport,
        battleSim: {} as GameApiContext['battleSim'],
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        auth: options.auth === undefined ? auth : options.auth,
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore,
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
    return { context, requestCommand };
};

describe('troop router permissions and mutations', () => {
    it('creates a troop only for the general owned by the authenticated user', async () => {
        const { context, requestCommand } = buildContext({
            result: { type: 'troopCreate', ok: true, generalId: 1, troopId: 1, troopName: '백마대' },
        });
        const caller = appRouter.createCaller(context);

        await expect(caller.troop.create({ troopName: '백마대' })).resolves.toEqual({
            ok: true,
            troopId: 1,
            troopName: '백마대',
        });
        expect(requestCommand).toHaveBeenCalledWith({
            type: 'troopCreate',
            generalId: 1,
            troopName: '백마대',
        });
    });

    it('rejects troop creation before daemon dispatch when already assigned or the name is blank', async () => {
        const assigned = buildContext({
            me: buildGeneral({ troopId: 9 }),
            result: null,
        });
        await expect(
            appRouter.createCaller(assigned.context).troop.create({ troopName: '신규대' })
        ).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
            message: '이미 부대에 소속되어 있습니다.',
        });
        expect(assigned.requestCommand).not.toHaveBeenCalled();

        const blank = buildContext({ result: null });
        await expect(appRouter.createCaller(blank.context).troop.create({ troopName: '   ' })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '부대 이름이 없습니다.',
        });
        expect(blank.requestCommand).not.toHaveBeenCalled();
    });

    it('rejects an over-width legacy troop name', async () => {
        const fixture = buildContext({ result: null });
        await expect(
            appRouter.createCaller(fixture.context).troop.create({ troopName: '가나다라마바사아자차' })
        ).rejects.toThrow('부대 이름은 전각 9자 또는 반각 18자 이하여야 합니다.');
        expect(fixture.requestCommand).not.toHaveBeenCalled();
    });

    it('allows only the current troop leader to kick a member', async () => {
        const unauthorized = buildContext({
            me: buildGeneral({ id: 2, troopId: 1 }),
            target: buildGeneral({ id: 3, userId: null, troopId: 1 }),
            result: null,
        });
        await expect(
            appRouter.createCaller(unauthorized.context).troop.kick({ troopId: 1, targetGeneralId: 3 })
        ).rejects.toMatchObject({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
        expect(unauthorized.requestCommand).not.toHaveBeenCalled();

        const authorized = buildContext({
            me: buildGeneral({ id: 1, troopId: 1 }),
            target: buildGeneral({ id: 3, userId: null, troopId: 1 }),
            result: { type: 'troopKick', ok: true, generalId: 1, troopId: 1, targetGeneralId: 3 },
        });
        await expect(
            appRouter.createCaller(authorized.context).troop.kick({ troopId: 1, targetGeneralId: 3 })
        ).resolves.toEqual({ ok: true });
        expect(authorized.requestCommand).toHaveBeenCalledWith({
            type: 'troopKick',
            generalId: 1,
            troopId: 1,
            targetGeneralId: 3,
        });
    });

    it('checks same-nation top-secret permission before renaming another troop', async () => {
        const forbidden = buildContext({
            me: buildGeneral({ id: 2, officerLevel: 1, meta: {} }),
            troop: { troopLeaderId: 1, nationId: 1, name: '구대' },
            result: null,
        });
        await expect(
            appRouter.createCaller(forbidden.context).troop.rename({ troopId: 1, troopName: '신대' })
        ).rejects.toMatchObject({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });

        const ambassador = buildContext({
            me: buildGeneral({ id: 2, officerLevel: 1, meta: { permission: 'ambassador' } }),
            troop: { troopLeaderId: 1, nationId: 1, name: '구대' },
            result: { type: 'troopRename', ok: true, generalId: 2, troopId: 1, troopName: '신대' },
        });
        await expect(
            appRouter.createCaller(ambassador.context).troop.rename({ troopId: 1, troopName: '신대' })
        ).resolves.toEqual({ ok: true, troopName: '신대' });

        const crossNation = buildContext({
            me: buildGeneral({ id: 2, officerLevel: 1, meta: { permission: 'ambassador' } }),
            troop: { troopLeaderId: 1, nationId: 9, name: '타국대' },
            result: null,
        });
        await expect(
            appRouter.createCaller(crossNation.context).troop.rename({ troopId: 1, troopName: '신대' })
        ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: '부대가 없습니다.' });
        expect(crossNation.requestCommand).not.toHaveBeenCalled();
    });

    it('does not accept troop mutations without authentication', async () => {
        const fixture = buildContext({ auth: null, result: null });
        await expect(
            appRouter.createCaller(fixture.context).troop.create({ troopName: '백마대' })
        ).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
        expect(fixture.requestCommand).not.toHaveBeenCalled();
    });
});
