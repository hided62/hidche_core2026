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

const context = (session: GameSessionTokenPayload | null, includeLegacy = false): GameApiContext => {
    const db = {
        $queryRaw: async (query: { strings?: readonly string[] }) => {
            if (!includeLegacy) return [];
            const sql = query.strings?.join(' ') ?? '';
            if (sql.includes('legacy_archive"."general')) {
                return [
                    {
                        sourceProfile: 'hwe',
                        serverId: 'hwe_archive_1',
                        generalNo: 21,
                        legacyId: 21,
                        owner: 'user-1',
                        name: '이전서버장수',
                        lastYearMonth: 21012,
                        turnTime: new Date('2020-01-02T00:00:00.000Z'),
                        schemaVersion: 1,
                        sourceFormat: 'legacy-flat-v0',
                        data: {
                            schemaVersion: 1,
                            identity: {
                                name: '이전서버장수',
                                picture: null,
                                imageServer: 0,
                                npcState: 0,
                                nationId: 2,
                                cityId: 1,
                                officerLevel: 7,
                                officerCity: 1,
                            },
                            stats: {
                                leadership: 91,
                                strength: 81,
                                intelligence: 71,
                                leadershipExperience: 3,
                                strengthExperience: 4,
                                intelligenceExperience: 5,
                            },
                            progression: {
                                experience: 900,
                                experienceLevel: 3,
                                dedication: 800,
                                dedicationLevel: 2,
                                age: 30,
                                startAge: 20,
                                bornYear: 180,
                                deadYear: 250,
                            },
                            traits: { personality: null, specialDomestic: null, specialWar: null },
                            resources: {
                                gold: 100,
                                rice: 200,
                                crew: 300,
                                crewType: '1',
                                train: 90,
                                morale: 80,
                                injury: 0,
                            },
                            items: { horse: null, weapon: null, book: null, item: null },
                            mastery: { infantry: 1000, archery: 2000, cavalry: 3000, special: 4000, siege: 5000 },
                            battle: {
                                battles: 10,
                                wins: 6,
                                losses: 4,
                                fireSuccesses: 2,
                                kills: 6,
                                deaths: 4,
                                killedCrew: 1000,
                                lostCrew: 500,
                                winRate: 60,
                                killRate: 200,
                                recentWar: null,
                                tactics: {
                                    total: { wins: null, draws: null, losses: null },
                                    leadership: { wins: null, draws: null, losses: null },
                                    intelligence: { wins: null, draws: null, losses: null },
                                },
                            },
                            history: ['이전 서버 열전'],
                            availability: {
                                mastery: true,
                                battleAggregates: true,
                                tactics: false,
                                history: true,
                                battleDetailLogs: false,
                                battleResultLogs: false,
                            },
                        },
                    },
                ];
            }
            if (sql.includes('legacy_archive"."game_history')) {
                return [
                    {
                        sourceProfile: 'hwe',
                        serverId: 'hwe_archive_1',
                        legacyId: 1,
                        openedAt: new Date('2019-09-21T00:00:00.000Z'),
                        completedAt: null,
                        legacyDate: new Date('2019-09-21T00:00:00.000Z'),
                        winnerNation: 2,
                        map: 'legacy',
                        season: 1,
                        scenario: 7,
                        scenarioName: '이전 시나리오',
                        rawEnv: {},
                    },
                ];
            }
            if (sql.includes('legacy_archive"."nation')) {
                return [
                    {
                        sourceProfile: 'hwe',
                        legacyId: 1,
                        serverId: 'hwe_archive_1',
                        nation: 2,
                        data: { name: '이전국', color: '#0000ff', level: 7 },
                        archivedAt: new Date('2020-01-02T00:00:00.000Z'),
                    },
                ];
            }
            if (sql.includes('legacy_archive"."emperor')) {
                return [{ id: 99n, sourceProfile: 'hwe', legacyId: 1, serverId: 'hwe_archive_1', data: {} }];
            }
            return [];
        },
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
                              nation: 3,
                              leader: 80,
                              power: 70,
                              intel: 60,
                              officer_level: 8,
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
            findFirst: async () => ({ id: 7, serverId: 'che_legacy_1' }),
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
                source: 'current',
                sourceProfile: 'che',
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
                        officerLevelText: '제2장군',
                        personal: '-',
                        historyCount: 2,
                    }),
                    expect.objectContaining({
                        name: '현재형장수',
                        nationName: '촉',
                        leadership: 81,
                        strength: 71,
                        intel: 61,
                        officerLevel: 7,
                        officerLevelText: '제2모사',
                        personal: '의리',
                        special: '상재',
                        special2: '신산',
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
        expect(result).toMatchObject({
            source: 'current',
            sourceProfile: 'che',
            serverId: 'che_legacy_1',
            generalNo: 10,
            dynastyPath: '/dynasty/7',
            nation: { id: 3, name: '촉', color: '#ff0000' },
            general: expect.objectContaining({ id: 10, name: '과거장수' }),
            battle: expect.objectContaining({ available: false }),
            logs: {
                generalHistory: {
                    available: true,
                    entries: [
                        { id: 1, text: '<C>●</>첫 기록' },
                        { id: 2, text: '<Y>●</>둘째 기록' },
                    ],
                },
                battleDetail: { available: false, entries: [] },
                battleResult: { available: false, entries: [] },
                generalAction: { available: false, entries: [] },
            },
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

    it('returns normalized previous-server detail from the dedicated archive without exposing raw data', async () => {
        const caller = appRouter.createCaller(context(auth, true));
        const list = await caller.archive.myPastPlays();
        expect(list.seasons).toContainEqual(
            expect.objectContaining({
                source: 'legacy',
                sourceProfile: 'hwe',
                serverId: 'hwe_archive_1',
                openedAt: '2019-09-21T00:00:00.000Z',
                dynastyId: 99,
                generals: [expect.objectContaining({ name: '이전서버장수', nationName: '이전국' })],
            })
        );

        const detail = await caller.archive.myPastPlayDetail({
            source: 'legacy',
            sourceProfile: 'hwe',
            serverId: 'hwe_archive_1',
            generalNo: 21,
        });
        expect(detail).toMatchObject({
            source: 'legacy',
            sourceProfile: 'hwe',
            dynastyPath: '/dynasty/99?source=legacy',
            nation: { id: 2, name: '이전국', color: '#0000ff' },
            general: expect.objectContaining({
                id: 21,
                name: '이전서버장수',
                stats: { leadership: 91, strength: 81, intelligence: 71 },
                progression: expect.objectContaining({ dex: [1000, 2000, 3000, 4000, 5000] }),
            }),
            battle: expect.objectContaining({ available: true, warnum: 10, wins: 6, winRate: 60 }),
            logs: expect.objectContaining({
                generalHistory: { available: true, entries: [{ id: 1, text: '이전 서버 열전' }] },
                battleDetail: { available: false, entries: [] },
            }),
        });
        expect(JSON.stringify(detail)).not.toContain('raw_data');
    });
});
