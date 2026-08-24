import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { appRouter } from '../src/router.js';

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-07-31T00:00:00.000Z',
    expiresAt: '2026-08-01T00:00:00.000Z',
    sessionId: 'diplomacy-html-session',
    user: {
        id: 'diplomacy-user',
        username: 'diplomacy-user',
        displayName: '외교 사용자',
        roles: [],
    },
    sanctions: {},
};

const buildGeneral = (officerLevel: number): GeneralRow => ({
    id: 1,
    userId: auth.user.id,
    name: '외교담당',
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
    officerLevel,
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
    turnTime: new Date('2026-07-31T00:00:00.000Z'),
    recentWarTime: null,
    age: 20,
    startAge: 20,
    personalCode: 'None',
    specialCode: 'None',
    special2Code: 'None',
    lastTurn: {},
    meta: {},
    penalty: {},
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
    updatedAt: new Date('2026-07-31T00:00:00.000Z'),
});

const storedLetter = {
    id: 7,
    srcNationId: 1,
    destNationId: 2,
    prevId: null,
    state: 'PROPOSED',
    textBrief: '<p>공개</p><img src=x onerror="globalThis.__briefXss=1"><script>alert(1)</script>',
    textDetail: '<strong>기밀</strong><a href="javascript:alert(2)" onclick="alert(3)">링크</a>',
    date: new Date('2026-07-31T00:00:00.000Z'),
    srcSignerId: 1,
    destSignerId: 2,
    aux: {
        src: { nationName: '위', nationColor: '#0000ff', generalId: 1, generalName: '외교담당' },
        dest: { nationName: '촉', nationColor: '#ff0000' },
    },
};

const buildContext = (officerLevel = 12, letter: Record<string, unknown> = storedLetter) => {
    const create = vi.fn(async () => ({ id: 9 }));
    const db = {
        general: {
            findFirst: vi.fn(async () => buildGeneral(officerLevel)),
            findMany: vi.fn(async () => [
                { id: 1, name: '현재 송신자', picture: 'src.jpg', imageServer: 0 },
                { id: 2, name: '현재 수신자', picture: 'dest.jpg', imageServer: 0 },
            ]),
        },
        nation: {
            findUnique: vi.fn(async () => ({ meta: {} })),
            findMany: vi.fn(async () => [
                { id: 1, name: '위', color: '#0000ff', level: 5 },
                { id: 2, name: '촉', color: '#ff0000', level: 5 },
            ]),
        },
        diplomacyLetter: {
            findMany: vi.fn(async () => [letter]),
            findFirst: vi.fn(async () => null),
            create,
        },
        worldState: {
            findFirst: vi.fn(async () => ({
                clockBaseTime: new Date('0185-01-01T00:00:00.000Z'),
                clockTick: 6n,
                clockMode: 'manual',
                clockWallAnchor: new Date('2026-07-31T00:00:00.000Z'),
                tickSeconds: 600,
            })),
        },
    };
    const redis = {
        get: async () => null,
        set: async () => null,
    } as unknown as RedisConnector['client'];
    const context: GameApiContext = {
        db: db as unknown as DatabaseClient,
        turnDaemon: new InMemoryTurnDaemonTransport(),
        battleSim: new InMemoryBattleSimTransport(),
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        auth,
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        redis,
        accessTokenStore: new RedisAccessTokenStore(redis, 'che:default'),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
    return { caller: appRouter.createCaller(context), create };
};

describe('diplomacy HTML API boundary', () => {
    it('purifies editor HTML before persistence', async () => {
        const fixture = buildContext();
        await expect(
            fixture.caller.diplomacy.sendLetter({
                destNationId: 2,
                brief: '<p><strong>공개</strong></p><img src="javascript:alert(1)" onerror="alert(2)">',
                detail: '<ul><li>조건</li></ul><a href="https://example.com" target="_blank">자료</a>',
            })
        ).resolves.toEqual({ id: 9 });

        expect(fixture.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                textBrief: '<p><strong>공개</strong></p>',
                textDetail:
                    '<ul><li>조건</li></ul><a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">자료</a>',
                date: new Date('0185-01-01T00:00:00.000Z'),
            }),
        });
    });

    it('purifies legacy stored rows on every read while preserving secret redaction', async () => {
        const visible = await buildContext(12).caller.diplomacy.getLetters();
        expect(visible.letters[0]).toMatchObject({
            brief: '<p>공개</p><img src="x" />',
            detail: '<strong>기밀</strong><a>링크</a>',
        });
        expect(JSON.stringify(visible)).not.toMatch(/onerror|onclick|javascript:|<script/i);

        const redacted = await buildContext(5).caller.diplomacy.getLetters();
        expect(redacted.permission).toBe(2);
        expect(redacted.letters[0]?.brief).toBe('<p>공개</p><img src="x" />');
        expect(redacted.letters[0]?.detail).toBe('(권한이 부족합니다)');
    });

    it('reconstructs imported letters whose snapshot metadata is empty', async () => {
        const imported = { ...storedLetter, aux: {} };
        const result = await buildContext(12, imported).caller.diplomacy.getLetters();

        expect(result.nations).toEqual([{ id: 2, name: '촉', color: '#ff0000', level: 5 }]);
        expect(result.letters[0]).toMatchObject({
            src: {
                nationName: '위',
                nationColor: '#0000ff',
                generalId: 1,
                generalName: '현재 송신자',
                generalPicture: 'src.jpg',
            },
            dest: {
                nationName: '촉',
                nationColor: '#ff0000',
                generalId: 2,
                generalName: '현재 수신자',
                generalPicture: 'dest.jpg',
            },
        });
    });

    it('rejects direct send mutations below the Ref diplomacy permission without writing', async () => {
        const fixture = buildContext(5);
        await expect(
            fixture.caller.diplomacy.sendLetter({ destNationId: 2, brief: '<p>공개</p>', detail: '<p>기밀</p>' })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(fixture.create).not.toHaveBeenCalled();
    });
});
