import { describe, expect, it } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import type { DatabaseClient, GameApiContext, GameProfile } from '../src/context.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { appRouter } from '../src/router.js';

const profile: GameProfile = {
    id: 'che',
    scenario: 'default',
    name: 'che:default',
};

const archiveServerId = 'hwe_260725_archive';
const currentServerId = 'che_260731_runtime';
const archiveRows = [
    {
        id: 1,
        profileName: archiveServerId,
        sourceId: 101,
        year: 200,
        month: 1,
        map: { year: 200, month: 1, startYear: 190, cityList: [], nationList: [] },
        nations: [{ id: 1, name: '촉', color: '#FF0000', level: 7, power: 1000, generalCount: 8, cities: ['성도'] }],
        globalHistory: ['<C>●</>1월: 기록 없음'],
        globalAction: ['<C>●</>1월: 기록 없음'],
        hash: 'archive-1',
        createdAt: new Date('2026-07-25T00:00:00.000Z'),
    },
    {
        id: 2,
        profileName: archiveServerId,
        sourceId: 102,
        year: 200,
        month: 2,
        map: { year: 200, month: 2, startYear: 190, cityList: [], nationList: [] },
        nations: [{ id: 1, name: '촉', color: '#FF0000', level: 7, power: 1200, generalCount: 9, cities: ['성도'] }],
        globalHistory: ['<C>●</>2월: 기록 없음'],
        globalAction: ['<C>●</>2월: 기록 없음'],
        hash: 'archive-2',
        createdAt: new Date('2026-07-25T01:00:00.000Z'),
    },
    {
        id: 3,
        profileName: currentServerId,
        sourceId: 0,
        year: 219,
        month: 12,
        map: { year: 219, month: 12, startYear: 190, cityList: [], nationList: [] },
        nations: [
            { id: 1, name: '현재기수국', color: '#00FF00', level: 7, power: 1300, generalCount: 10, cities: ['낙양'] },
        ],
        globalHistory: ['저장된 현재 기수 과거 기록'],
        globalAction: ['저장된 현재 기수 과거 행동'],
        hash: 'current-archive',
        createdAt: new Date('2026-07-31T00:00:00.000Z'),
    },
    {
        id: 4,
        profileName: profile.id,
        sourceId: 201,
        year: 219,
        month: 11,
        map: { year: 219, month: 11, startYear: 190, cityList: [], nationList: [] },
        nations: [],
        globalHistory: ['레거시 프로필 별칭 기록'],
        globalAction: [],
        hash: 'legacy-profile-alias',
        createdAt: new Date('2026-07-30T00:00:00.000Z'),
    },
];

const authFor = (userId: string): GameSessionTokenPayload => ({
    version: 1,
    profile: profile.name,
    issuedAt: '2026-07-25T00:00:00.000Z',
    expiresAt: '2026-07-26T00:00:00.000Z',
    sessionId: `session-${userId}`,
    user: {
        id: userId,
        username: userId,
        displayName: userId,
        roles: [],
    },
    sanctions: {},
});

const buildContext = (
    auth: GameSessionTokenPayload | null,
    options: { hasGeneral?: boolean; worldMeta?: unknown } = {}
): GameApiContext => {
    const db = {
        general: {
            findFirst: async ({ where }: { where: { userId: string } }) =>
                options.hasGeneral === false ? null : { id: where.userId === 'owner-a' ? 1 : 2, userId: where.userId },
        },
        worldState: {
            findFirst: async () => ({
                currentYear: 220,
                currentMonth: 1,
                meta: options.worldMeta ?? { serverId: currentServerId },
            }),
        },
        yearbookHistory: {
            findFirst: async (args: {
                where: { profileName: string; year?: number; month?: number };
                orderBy?: Array<{ year?: 'asc' | 'desc'; month?: 'asc' | 'desc' }>;
            }) => {
                const candidates = archiveRows.filter(
                    (row) =>
                        row.profileName === args.where.profileName &&
                        (args.where.year === undefined || row.year === args.where.year) &&
                        (args.where.month === undefined || row.month === args.where.month)
                );
                if (!args.orderBy) {
                    return candidates[0] ?? null;
                }
                const descending = args.orderBy[0]?.year === 'desc';
                return (descending ? candidates.at(-1) : candidates[0]) ?? null;
            },
        },
    };
    const redis = {
        get: async () => null,
        set: async () => null,
    } as unknown as RedisConnector['client'];

    return {
        db: db as unknown as DatabaseClient,
        turnDaemon: new InMemoryTurnDaemonTransport(),
        battleSim: new InMemoryBattleSimTransport(),
        profile,
        auth,
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        redis,
        accessTokenStore: new RedisAccessTokenStore(redis, profile.name),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
};

describe('historical yearbook access from dynasty', () => {
    it('selects the archived server range without treating it as the live month', async () => {
        const caller = appRouter.createCaller(buildContext(authFor('owner-a')));
        const result = await caller.yearbook.getRange({ serverID: archiveServerId });

        expect(result).toEqual({
            firstYearMonth: 200 * 12,
            lastYearMonth: 200 * 12 + 1,
            currentYearMonth: 200 * 12 + 1,
        });
    });

    it('returns the same archived public history for distinct general owners', async () => {
        const ownerA = appRouter.createCaller(buildContext(authFor('owner-a')));
        const ownerB = appRouter.createCaller(buildContext(authFor('owner-b')));

        const [resultA, resultB] = await Promise.all([
            ownerA.yearbook.getHistory({ serverID: archiveServerId, year: 200, month: 2 }),
            ownerB.yearbook.getHistory({ serverID: archiveServerId, year: 200, month: 2 }),
        ]);

        expect(resultB).toEqual(resultA);
        expect(resultA).toMatchObject({
            notModified: false,
            data: {
                year: 200,
                month: 2,
                nations: [{ id: 1, name: '촉', generalCount: 9, cities: ['성도'] }],
                globalHistory: ['<C>●</>2월: 기록 없음'],
                globalAction: ['<C>●</>2월: 기록 없음'],
            },
        });
    });

    it('requires both an authenticated user and a user-owned general like legacy v_history.php', async () => {
        const anonymous = appRouter.createCaller(buildContext(null));
        const noGeneral = appRouter.createCaller(buildContext(authFor('owner-a'), { hasGeneral: false }));

        await expect(anonymous.yearbook.getRange({ serverID: archiveServerId })).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
        await expect(noGeneral.yearbook.getRange({ serverID: archiveServerId })).rejects.toMatchObject({
            code: 'NOT_FOUND',
            message: 'General not found',
        });
    });

    it('rejects unknown archived server IDs instead of falling back to the live profile', async () => {
        const caller = appRouter.createCaller(buildContext(authFor('owner-a')));

        await expect(caller.yearbook.getRange({ serverID: 'missing-server' })).rejects.toMatchObject({
            code: 'NOT_FOUND',
            message: '연감 범위를 찾을 수 없습니다.',
        });
    });

    it('treats the canonical server ID and profile alias as the same live generation', async () => {
        const caller = appRouter.createCaller(buildContext(authFor('owner-a')));

        const [canonical, alias, omitted] = await Promise.all([
            caller.yearbook.getRange({ serverID: currentServerId }),
            caller.yearbook.getRange({ serverID: profile.name }),
            caller.yearbook.getRange(),
        ]);

        expect(canonical).toEqual(alias);
        expect(alias).toEqual(omitted);
        expect(canonical).toEqual({
            firstYearMonth: 219 * 12 + 11,
            lastYearMonth: 219 * 12 + 11,
            currentYearMonth: 220 * 12,
        });
    });

    it('reads imported history under the short profile ID when world metadata has no server ID', async () => {
        const caller = appRouter.createCaller(buildContext(authFor('owner-a'), { worldMeta: {} }));

        await expect(caller.yearbook.getRange()).resolves.toEqual({
            firstYearMonth: 219 * 12 + 10,
            lastYearMonth: 219 * 12 + 10,
            currentYearMonth: 220 * 12,
        });
    });

    it('uses stored logs for a past month of the current generation', async () => {
        const caller = appRouter.createCaller(buildContext(authFor('owner-a')));

        const result = await caller.yearbook.getHistory({
            serverID: currentServerId,
            year: 219,
            month: 12,
        });

        expect(result).toMatchObject({
            notModified: false,
            data: {
                globalHistory: ['저장된 현재 기수 과거 기록'],
                globalAction: ['저장된 현재 기수 과거 행동'],
            },
        });
    });
});
