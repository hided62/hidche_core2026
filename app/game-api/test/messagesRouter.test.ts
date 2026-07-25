import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { appRouter } from '../src/router.js';
import type { GameApiContext, GeneralRow } from '../src/context.js';

const general = {
    id: 7,
    userId: 'user-7',
    name: '보낸이',
    nationId: 1,
    officerLevel: 5,
    npcState: 0,
    meta: {},
    penalty: {},
} as GeneralRow;

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    sessionId: 'session-7',
    user: {
        id: 'user-7',
        username: 'tester',
        displayName: 'Tester',
        roles: ['user'],
    },
    sanctions: {},
};

const buildContext = (overrides: Record<string, unknown> = {}) => {
    const executeRaw = vi.fn(async () => 1);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const db = {
        general: {
            findUnique: vi.fn(async () => general),
            findMany: vi.fn(async () => []),
        },
        nation: {
            findMany: vi.fn(async () => []),
            findUnique: vi.fn(async () => null),
        },
        messageReadState: {
            findUnique: vi.fn(async () => ({
                generalId: general.id,
                latestPrivateMessage: 11,
                latestDiplomacyMessage: 13,
                updatedAt: new Date(),
            })),
        },
        message: { updateMany },
        $queryRaw: vi.fn(async () => []),
        $executeRaw: executeRaw,
        ...overrides,
    };
    const context = {
        db,
        auth,
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        redis: {},
        turnDaemon: {},
        battleSim: {},
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore: {},
        flushStore: {},
        gameTokenSecret: 'test-secret',
    } as unknown as GameApiContext;
    return { caller: appRouter.createCaller(context), db, executeRaw, updateMany };
};

describe('messages router missing-flow compatibility', () => {
    it('returns persisted latest-read positions with recent messages', async () => {
        const { caller } = buildContext();
        const result = await caller.messages.getRecent({ generalId: general.id });

        expect(result.latestRead).toEqual({ private: 11, diplomacy: 13 });
    });

    it('persists latest-read updates through the monotonic upsert', async () => {
        const { caller, executeRaw } = buildContext();

        await caller.messages.readLatest({
            generalId: general.id,
            type: 'private',
            messageId: 17,
        });

        expect(executeRaw).toHaveBeenCalledOnce();
    });

    it('invalidates a recent owned message and its receiver copy', async () => {
        const queryRaw = vi.fn(async () => [
            {
                id: 21,
                mailbox: general.id,
                type: 'private',
                src: general.id,
                dest: 8,
                time: new Date(),
                valid_until: new Date('9999-12-31T00:00:00Z'),
                message: {
                    src: {
                        generalId: general.id,
                        generalName: general.name,
                        nationId: 1,
                        nationName: '위',
                        color: '#fff',
                        icon: '',
                    },
                    dest: {
                        generalId: 8,
                        generalName: '받는이',
                        nationId: 2,
                        nationName: '촉',
                        color: '#000',
                        icon: '',
                    },
                    text: '삭제할 메시지',
                    option: { receiverMessageID: 22 },
                },
            },
        ]);
        const { caller, updateMany } = buildContext({ $queryRaw: queryRaw });

        const result = await caller.messages.delete({ generalId: general.id, messageId: 21 });

        expect(result.deletedIds).toEqual([21, 22]);
        expect(updateMany).toHaveBeenCalledWith({
            where: { id: { in: [21, 22] } },
            data: { validUntil: expect.any(Date) },
        });
    });

    it('rejects deleting another general message', async () => {
        const queryRaw = vi.fn(async () => [
            {
                id: 23,
                mailbox: general.id,
                type: 'private',
                src: 99,
                dest: general.id,
                time: new Date(),
                valid_until: new Date('9999-12-31T00:00:00Z'),
                message: {
                    src: { generalId: 99, generalName: '타인', nationId: 1, nationName: '위', color: '#fff', icon: '' },
                    dest: {
                        generalId: general.id,
                        generalName: general.name,
                        nationId: 1,
                        nationName: '위',
                        color: '#fff',
                        icon: '',
                    },
                    text: '타인 메시지',
                    option: {},
                },
            },
        ]);
        const { caller } = buildContext({ $queryRaw: queryRaw });

        await expect(caller.messages.delete({ generalId: general.id, messageId: 23 })).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
    });
});
