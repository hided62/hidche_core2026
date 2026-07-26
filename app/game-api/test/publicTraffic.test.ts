import { describe, expect, it } from 'vitest';

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

const buildContext = (): GameApiContext => {
    const db = {
        worldState: {
            findFirst: async () => ({
                id: 1,
                currentYear: 185,
                currentMonth: 3,
                tickSeconds: 600,
                config: {},
                meta: {
                    lastTurnTime: '2026-07-26T03:00:00.000Z',
                    refresh: 12,
                    maxrefresh: 30,
                    maxonline: 5,
                    recentTraffic: [
                        {
                            year: 185,
                            month: 2,
                            refresh: 30,
                            online: 5,
                            date: '2026-07-26 02:50:00',
                        },
                    ],
                },
            }),
        },
        generalAccessLog: {
            aggregate: async () => ({
                _sum: {
                    refresh: 12,
                    refreshScoreTotal: 21,
                },
            }),
            count: async (args: { where: { lastRefresh: { gte: Date } } }) => {
                expect(args.where.lastRefresh.gte).toEqual(new Date('2026-07-26T03:00:00.000Z'));
                return 2;
            },
            findMany: async () => [
                { generalId: 7, refresh: 9, refreshScoreTotal: 15 },
                { generalId: 8, refresh: 3, refreshScoreTotal: 6 },
            ],
        },
        general: {
            findMany: async () => [
                { id: 7, name: '갑' },
                { id: 8, name: '을' },
            ],
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
        auth: null,
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        redis,
        accessTokenStore: new RedisAccessTokenStore(redis, profile.name),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
};

describe('public.getTraffic', () => {
    it('is public and returns only aggregate traffic plus allowlisted general names', async () => {
        const result = await appRouter.createCaller(buildContext()).public.getTraffic();

        expect(result.history).toHaveLength(2);
        expect(result.history[0]).toEqual({
            year: 185,
            month: 2,
            refresh: 30,
            online: 5,
            date: '2026-07-26 02:50:00',
        });
        expect(result.history[1]).toMatchObject({
            year: 185,
            month: 3,
            refresh: 12,
            online: 2,
        });
        expect(result.maxRefresh).toBe(30);
        expect(result.maxOnline).toBe(5);
        expect(result.suspects).toEqual([
            { generalId: null, name: '접속자 총합', refresh: 12, refreshScoreTotal: 21 },
            { generalId: 7, name: '갑', refresh: 9, refreshScoreTotal: 15 },
            { generalId: 8, name: '을', refresh: 3, refreshScoreTotal: 6 },
        ]);
        expect(JSON.stringify(result)).not.toContain('userId');
    });
});
