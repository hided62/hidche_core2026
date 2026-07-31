import { describe, expect, it } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GameProfile } from '../src/context.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { appRouter } from '../src/router.js';

const profile: GameProfile = {
    id: 'che',
    scenario: 'default',
    name: 'che:default',
};

const buildContext = (auth: GameSessionTokenPayload | null = null): GameApiContext => {
    const generalRows = [
        {
            id: 10,
            name: '관우',
            picture: '10.jpg',
            imageServer: 0,
            npcState: 1,
            age: 42,
            officerLevel: 5,
            nationId: 1,
            leadership: 90,
            strength: 95,
            intel: 75,
            experience: 800,
            dedication: 700,
            personalCode: 'None',
            specialCode: 'None',
            special2Code: 'None',
            meta: { owner_name: '악령 관우', explevel: 4, killturn: 7 },
        },
        {
            id: 20,
            name: '조운',
            picture: '20.jpg',
            imageServer: 1,
            npcState: 2,
            age: 35,
            officerLevel: 0,
            nationId: 0,
            leadership: 90,
            strength: 95,
            intel: 75,
            experience: 900,
            dedication: 600,
            personalCode: 'None',
            specialCode: 'None',
            special2Code: 'None',
            meta: { owner_name: '노출 금지', explevel: 5 },
        },
        {
            id: 30,
            name: '유비',
            picture: '30.jpg',
            imageServer: 0,
            npcState: 0,
            age: 44,
            officerLevel: 12,
            nationId: 1,
            leadership: 80,
            strength: 70,
            intel: 85,
            experience: 16_000,
            dedication: 10_000,
            personalCode: 'None',
            specialCode: 'None',
            special2Code: 'None',
            meta: { owner_name: '노출 금지', explevel: 9 },
        },
    ];
    const db = {
        general: {
            findMany: async (args: { where?: { npcState: { gt: number } } }) => {
                if (args.where) {
                    expect(args.where).toEqual({ npcState: { gt: 0 } });
                    return generalRows.filter((general) => general.npcState > 0);
                }
                return generalRows;
            },
        },
        nation: {
            findMany: async () => [{ id: 1, name: '촉', level: 5 }],
        },
        npcSelectionToken: {
            findMany: async (args: { where: { validUntil: { gte: Date } } }) => {
                expect(args.where.validUntil.gte).toBeInstanceOf(Date);
                return [
                    {
                        pickResult: {
                            10: { keepCount: 2 },
                            invalid: { keepCount: 'bad' },
                        },
                    },
                    {
                        pickResult: {
                            20: { keepCount: -1 },
                        },
                    },
                ];
            },
        },
        worldState: {
            findFirst: async () => ({
                config: { const: { maxLevel: 255, maxDedLevel: 30 } },
            }),
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

describe('public.getNpcList', () => {
    it('returns only the legacy-compatible public DTO without user identifiers', async () => {
        const result = await appRouter.createCaller(buildContext()).public.getNpcList({ sort: 1 });

        expect(result.generals).toEqual([
            {
                id: 10,
                name: '관우',
                picture: '10.jpg',
                imageServer: 0,
                npcState: 1,
                ownerName: '악령 관우',
                age: 42,
                level: 4,
                officerLevel: 5,
                killturn: 7,
                nationId: 1,
                nationName: '촉',
                nationLevel: 5,
                personality: null,
                specialDomestic: null,
                specialWar: null,
                statTotal: 260,
                leadership: 90,
                strength: 95,
                intelligence: 75,
                experience: 800,
                experienceText: '무명',
                dedication: 700,
                dedicationText: '28품관',
            },
            {
                id: 20,
                name: '조운',
                picture: '20.jpg',
                imageServer: 1,
                npcState: 2,
                ownerName: '',
                age: 35,
                level: 5,
                officerLevel: 0,
                killturn: 0,
                nationId: 0,
                nationName: '-',
                nationLevel: 0,
                personality: null,
                specialDomestic: null,
                specialWar: null,
                statTotal: 260,
                leadership: 90,
                strength: 95,
                intelligence: 75,
                experience: 900,
                experienceText: '무명',
                dedication: 600,
                dedicationText: '28품관',
            },
        ]);
        expect(result.tokenKeepCounts).toEqual({});
        expect(JSON.stringify(result)).not.toContain('노출 금지');
        expect(JSON.stringify(result)).not.toContain('userId');
    });

    it('returns the full id-ordered list and every active reservation only to an authenticated caller', async () => {
        const auth: GameSessionTokenPayload = {
            version: 1,
            profile: 'che:default',
            issuedAt: '2026-07-31T00:00:00.000Z',
            expiresAt: '2026-08-31T00:00:00.000Z',
            sessionId: 'npc-list-owner',
            user: {
                id: 'owner-user',
                username: 'owner-user',
                displayName: '소유자',
                roles: ['user'],
                legacyMemberNo: 101,
            },
            sanctions: {},
        };

        const result = await appRouter
            .createCaller(buildContext(auth))
            .public.getNpcList({ sort: 1, includeAllWithToken: true });

        expect(result.tokenKeepCounts).toEqual({ 10: 2, 20: 0 });
        expect(result.generals.map((general) => general.id)).toEqual([10, 20, 30]);
        expect(result.generals[2]).toMatchObject({
            npcState: 0,
            level: 40,
            experienceText: '지역적',
            dedicationText: '21품관',
        });
    });

    it('rejects the token-aware full list without an authenticated session', async () => {
        await expect(
            appRouter.createCaller(buildContext()).public.getNpcList({ sort: 1, includeAllWithToken: true })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('keeps pool rows before possessed NPCs when the selected value is tied', async () => {
        const result = await appRouter.createCaller(buildContext()).public.getNpcList({ sort: 3 });

        expect(result.generals.map((general) => general.id)).toEqual([20, 10]);
    });

    it('falls an invalid legacy sort value back to name order', async () => {
        const caller = appRouter.createCaller(buildContext());
        const result = await caller.public.getNpcList({ sort: 99 } as unknown as { sort: 1 });

        expect(result.sort).toBe(1);
        expect(result.generals.map((general) => general.name)).toEqual(['관우', '조운']);
    });
});
