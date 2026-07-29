import { describe, expect, it } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import type { DatabaseClient, GameApiContext } from '../src/context.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { appRouter } from '../src/router.js';

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-07-27T00:00:00.000Z',
    expiresAt: '2026-07-28T00:00:00.000Z',
    sessionId: 'archive-session',
    user: {
        id: 'user-1',
        username: 'user-1',
        displayName: '테스터',
        roles: ['user'],
    },
    sanctions: {},
};

const context = (session: GameSessionTokenPayload | null): GameApiContext => {
    const db = {
        oldGeneral: {
            findMany: async ({ where }: { where: { owner: string } }) =>
                where.owner === 'user-1'
                    ? [
                          {
                              id: 1,
                              serverId: 'che_legacy_1',
                              generalNo: 10,
                              owner: 'user-1',
                              name: '과거장수',
                              lastYearMonth: 22012,
                              turnTime: new Date('2025-01-01T00:00:00.000Z'),
                              data: {
                                  nation: 3,
                                  leader: 80,
                                  power: 70,
                                  intel: 60,
                                  officer_level: 8,
                                  personal: 3,
                                  history: '<C>●</>첫 기록<br><Y>●</>둘째 기록<br>',
                              },
                          },
                          {
                              id: 2,
                              serverId: 'che_legacy_1',
                              generalNo: 11,
                              owner: 'user-1',
                              name: '현재형장수',
                              lastYearMonth: 22012,
                              turnTime: new Date('2025-01-01T00:00:00.000Z'),
                              data: {
                                  nationId: 3,
                                  stats: { leadership: 81, strength: 71, intelligence: 61 },
                                  officerLevel: 7,
                                  role: {
                                      personality: 'che_의리',
                                      specialDomestic: 'che_상재',
                                      specialWar: 'che_신산',
                                  },
                                  history: ['<C>●</>현재형 기록'],
                              },
                          },
                      ]
                    : [],
            findFirst: async ({ where }: { where: { owner: string; serverId: string; generalNo: number } }) =>
                where.owner === 'user-1' && where.serverId === 'che_legacy_1' && where.generalNo === 10
                    ? {
                          id: 1,
                          serverId: 'che_legacy_1',
                          generalNo: 10,
                          owner: 'user-1',
                          name: '과거장수',
                          lastYearMonth: 22012,
                          turnTime: new Date('2025-01-01T00:00:00.000Z'),
                          data: {
                              history: '<C>●</>첫 기록<br><Y>●</>둘째 기록<br>',
                          },
                      }
                    : null,
        },
        gameHistory: {
            findMany: async () => [
                {
                    id: 1,
                    serverId: 'che_legacy_1',
                    date: new Date('2025-01-02T00:00:00.000Z'),
                    winnerNation: 3,
                    map: 'scenario',
                    season: 1,
                    scenario: 100,
                    scenarioName: '테스트',
                    env: {},
                },
            ],
        },
        oldNation: {
            findMany: async () => [
                {
                    id: 1,
                    serverId: 'che_legacy_1',
                    nation: 3,
                    sourceId: 5,
                    data: { name: '촉', color: '#ff0000' },
                    date: new Date('2025-01-02T00:00:00.000Z'),
                },
            ],
        },
        emperor: {
            findMany: async () => [{ id: 7, serverId: 'che_legacy_1' }],
        },
    };
    const redis = {
        get: async () => null,
        set: async () => null,
    } as unknown as RedisConnector['client'];
    return {
        db: db as unknown as DatabaseClient,
        redis,
        turnDaemon: new InMemoryTurnDaemonTransport(),
        battleSim: new InMemoryBattleSimTransport(),
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        auth: session,
        accessTokenStore: new RedisAccessTokenStore(redis, 'che:default'),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
};

describe('archive.myPastPlays', () => {
    it('requires authentication and returns only the authenticated owner archive', async () => {
        await expect(appRouter.createCaller(context(null)).archive.myPastPlays()).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
        const result = await appRouter.createCaller(context(auth)).archive.myPastPlays();
        expect(result.seasons).toEqual([
            expect.objectContaining({
                serverId: 'che_legacy_1',
                scenarioName: '테스트',
                dynastyId: 7,
                generals: [
                    expect.objectContaining({
                        name: '과거장수',
                        nationName: '촉',
                        leadership: 80,
                        strength: 70,
                        officerLevel: 8,
                        personal: '3',
                        historyCount: 2,
                    }),
                    expect.objectContaining({
                        name: '현재형장수',
                        nationName: '촉',
                        leadership: 81,
                        strength: 71,
                        intel: 61,
                        officerLevel: 7,
                        personal: 'che_의리',
                        special: 'che_상재',
                        special2: 'che_신산',
                        historyCount: 1,
                    }),
                ],
            }),
        ]);
    });

    it('loads archived history only for a general owned by the authenticated session', async () => {
        const input = { serverId: 'che_legacy_1', generalNo: 10 };
        await expect(appRouter.createCaller(context(null)).archive.myPastPlayDetail(input)).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });

        const result = await appRouter.createCaller(context(auth)).archive.myPastPlayDetail(input);
        expect(result).toEqual({
            serverId: 'che_legacy_1',
            generalNo: 10,
            name: '과거장수',
            lastYearMonth: 22012,
            history: ['<C>●</>첫 기록', '<Y>●</>둘째 기록'],
        });

        const otherUser = {
            ...auth,
            sessionId: 'other-session',
            user: { ...auth.user, id: 'user-2', username: 'user-2' },
        };
        await expect(appRouter.createCaller(context(otherUser)).archive.myPastPlayDetail(input)).rejects.toMatchObject({
            code: 'NOT_FOUND',
        });
    });
});
