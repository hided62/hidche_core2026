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

const buildContext = (): GameApiContext => {
    const generalRows = [
        {
            id: 10,
            name: '관우',
            npcState: 1,
            nationId: 1,
            leadership: 90,
            strength: 95,
            intel: 75,
            experience: 800,
            dedication: 700,
            personalCode: 'None',
            specialCode: 'None',
            special2Code: 'None',
            meta: { owner_name: '악령 관우', explevel: 4 },
        },
        {
            id: 20,
            name: '조운',
            npcState: 2,
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
    ];
    const db = {
        general: {
            findMany: async (args: { where: { npcState: { gt: number } } }) => {
                expect(args.where).toEqual({ npcState: { gt: 0 } });
                return generalRows;
            },
        },
        nation: {
            findMany: async () => [{ id: 1, name: '촉' }],
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
        auth: null as GameSessionTokenPayload | null,
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
                npcState: 1,
                ownerName: '악령 관우',
                level: 4,
                nationId: 1,
                nationName: '촉',
                personality: null,
                specialDomestic: null,
                specialWar: null,
                statTotal: 260,
                leadership: 90,
                strength: 95,
                intelligence: 75,
                experience: 800,
                dedication: 700,
            },
            {
                id: 20,
                name: '조운',
                npcState: 2,
                ownerName: '',
                level: 5,
                nationId: 0,
                nationName: '-',
                personality: null,
                specialDomestic: null,
                specialWar: null,
                statTotal: 260,
                leadership: 90,
                strength: 95,
                intelligence: 75,
                experience: 900,
                dedication: 600,
            },
        ]);
        expect(JSON.stringify(result)).not.toContain('노출 금지');
        expect(JSON.stringify(result)).not.toContain('userId');
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
