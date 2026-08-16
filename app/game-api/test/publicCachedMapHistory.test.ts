import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GameProfile } from '../src/context.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { appRouter } from '../src/router.js';

const profile: GameProfile = {
    id: 'che',
    scenario: 'default',
    name: 'che:default',
};

const buildContext = () => {
    const redis = {
        get: vi.fn(async () => null),
        set: vi.fn(async () => 'OK'),
    };
    const db = {
        worldState: {
            findFirst: vi.fn(async () => ({
                currentYear: 190,
                currentMonth: 3,
                config: {
                    const: {
                        maxTechLevel: 10,
                        initialAllowedTechLevel: 2,
                        techLevelIncYear: 4,
                    },
                },
                meta: { scenarioMeta: { startYear: 184 } },
            })),
        },
        logEntry: {
            findMany: vi.fn(async () => [
                { id: 9, text: '<Y>최근 정세</>' },
                { id: 8, text: '이전 정세' },
            ]),
        },
        $queryRaw: vi
            .fn()
            .mockResolvedValueOnce([{ coverageVersion: 0, revision: null }])
            .mockResolvedValueOnce([{ id: 1, level: 5, nationId: 1, region: 1, supplyState: 1, meta: { state: 0 } }])
            .mockResolvedValueOnce([{ id: 1, name: '촉', color: '#ff0000', capitalCityId: 1, meta: {} }]),
    };
    const context: GameApiContext = {
        db: db as unknown as DatabaseClient,
        redis: redis as unknown as RedisConnector['client'],
        turnDaemon: new InMemoryTurnDaemonTransport(),
        battleSim: new InMemoryBattleSimTransport(),
        profile,
        auth: null as GameSessionTokenPayload | null,
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore: new RedisAccessTokenStore(redis as unknown as RedisConnector['client'], profile.name),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
    return { context, db, redis };
};

describe('public.getCachedMap', () => {
    it('caches the neutral map and ten latest public history rows as one snapshot', async () => {
        const fixture = buildContext();
        const result = await appRouter.createCaller(fixture.context).public.getCachedMap();

        expect(result).toMatchObject({
            year: 190,
            month: 3,
            techLevelLimit: {
                maxLevel: 10,
                initialLevel: 2,
                increaseYears: 4,
            },
            history: [
                { id: 9, text: '<Y>최근 정세</>' },
                { id: 8, text: '이전 정세' },
            ],
        });
        expect(fixture.db.logEntry.findMany).toHaveBeenCalledWith({
            where: { scope: 'SYSTEM', category: 'HISTORY' },
            select: { id: true, text: true },
            orderBy: { id: 'desc' },
            take: 10,
        });
        expect(fixture.redis.set).toHaveBeenCalledWith(
            'sammo:public:cachedMapWithHistory:che:default',
            expect.stringContaining('최근 정세'),
            { EX: 600 }
        );
    });
});
