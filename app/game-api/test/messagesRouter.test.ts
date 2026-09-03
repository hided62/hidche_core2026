import { describe, expect, it, vi } from 'vitest';

import { ChangeJournal } from '@sammo-ts/common';
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

const buildContext = (overrides: Record<string, unknown> = {}, contextOverrides: Record<string, unknown> = {}) => {
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
    const redis = {
        set: vi.fn(async () => 'OK'),
        publish: vi.fn(async () => 1),
    };
    const context = {
        db,
        auth,
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        redis,
        turnDaemon: {},
        battleSim: {},
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        accessTokenStore: {},
        flushStore: {},
        gameTokenSecret: 'test-secret',
        ...contextOverrides,
    } as unknown as GameApiContext;
    return { caller: appRouter.createCaller(context), db, executeRaw, updateMany, redis };
};

describe('messages router missing-flow compatibility', () => {
    it('returns persisted latest-read positions with recent messages', async () => {
        const { caller } = buildContext();
        const result = await caller.messages.getRecent({ generalId: general.id });

        expect(result.latestRead).toEqual({ private: 11, diplomacy: 13 });
        expect(result.canRespondDiplomacy).toBe(false);
    });

    it('marks the current ruler as able to answer diplomacy prompts', async () => {
        const ruler = { ...general, officerLevel: 12 };
        const { caller } = buildContext({
            general: {
                findUnique: vi.fn(async () => ruler),
                findMany: vi.fn(async () => []),
            },
            nation: {
                findMany: vi.fn(async () => []),
                findUnique: vi.fn(async () => ({ meta: {} })),
            },
        });

        const result = await caller.messages.getRecent({ generalId: ruler.id });

        expect(result.canRespondDiplomacy).toBe(true);
    });

    it('lists an appointed ambassador as permission 4 but keeps responses limited to officers', async () => {
        const ambassador = {
            ...general,
            officerLevel: 1,
            meta: { permission: 'ambassador' },
        } as GeneralRow;
        const { caller } = buildContext({
            general: {
                findUnique: vi.fn(async () => ambassador),
                findMany: vi.fn(async () => []),
            },
            nation: {
                findMany: vi.fn(async () => []),
                findUnique: vi.fn(async () => ({ meta: {} })),
            },
        });

        const result = await caller.messages.getRecent({ generalId: ambassador.id });

        expect(result.permission).toBe(4);
        expect(result.canRespondDiplomacy).toBe(false);
    });

    it('redacts recent and old diplomacy content below secret permission 3', async () => {
        const diplomacyRow = {
            id: 19,
            mailbox: 9001,
            type: 'diplomacy',
            src: 9002,
            dest: 9001,
            time: new Date(),
            valid_until: new Date('9999-12-31T00:00:00Z'),
            message: {
                src: {
                    generalId: 8,
                    generalName: '외교관',
                    nationId: 2,
                    nationName: '촉',
                    color: '#000000',
                    icon: '',
                },
                dest: {
                    generalId: 0,
                    generalName: '',
                    nationId: 1,
                    nationName: '위',
                    color: '#ffffff',
                    icon: '',
                },
                text: '보이면 안 되는 외교 본문',
                option: { action: 'noAggression' },
            },
        };
        const queryRaw = vi.fn(async () => [diplomacyRow]);
        const { caller } = buildContext({
            $queryRaw: queryRaw,
            nation: {
                findMany: vi.fn(async () => []),
                findUnique: vi.fn(async () => ({ meta: {} })),
            },
        });

        const recent = await caller.messages.getRecent({ generalId: general.id });
        const old = await caller.messages.getOld({
            generalId: general.id,
            type: 'diplomacy',
            to: 20,
        });

        expect(recent.permission).toBe(2);
        expect(recent.diplomacy[0]).toMatchObject({
            text: '조회 권한이 없는 외교 메시지입니다.',
            option: { action: 'noAggression' },
        });
        expect(recent.diplomacy[0]?.option).not.toHaveProperty('invalid');
        expect(old.diplomacy[0]).toMatchObject({
            text: '조회 권한이 없는 외교 메시지입니다.',
            option: { action: 'noAggression' },
        });
        expect(old.diplomacy[0]?.option).not.toHaveProperty('invalid');
    });

    it('forces a non-diplomat foreign nation target back to the owned nation mailbox', async () => {
        const queryRaw = vi.fn(async () => [{ id: 51 }]);
        const findNation = vi.fn(async ({ where }: { where: { id: number } }) => ({
            id: where.id,
            name: where.id === 1 ? '위' : '촉',
            color: '#112233',
            meta: {},
        }));
        const { caller } = buildContext({
            $queryRaw: queryRaw,
            nation: {
                findMany: vi.fn(async () => []),
                findUnique: findNation,
            },
        });

        const result = await caller.messages.send({
            generalId: general.id,
            mailbox: 9002,
            text: '국가 메시지',
        });

        expect(result.msgType).toBe('national');
        expect(queryRaw).toHaveBeenCalledOnce();
    });

    it('journals committed message mailbox copies instead of publishing before commit', async () => {
        const changeJournal = new ChangeJournal();
        const queryRaw = vi.fn(async () => [{ id: 51 }]);
        const { caller, redis } = buildContext({ $queryRaw: queryRaw }, { changeJournal });

        await caller.messages.send({
            generalId: general.id,
            mailbox: 9999,
            text: '공개 메시지',
        });

        expect(changeJournal.snapshot()).toEqual([{ domain: 'messages.mailbox', entityId: 9999 }]);
        expect(redis.publish).not.toHaveBeenCalled();
    });

    it.each(['PREOPEN', 'SUSPENDED', 'RECONCILING'] as const)(
        'keeps ordinary public messages available while the game clock is %s',
        async (clockPhase) => {
            const queryRaw = vi.fn(async () => [{ id: 52 }]);
            const { caller } = buildContext({
                $queryRaw: queryRaw,
                worldState: { findFirst: vi.fn(async () => ({ clockPhase })) },
            });

            await expect(
                caller.messages.send({ generalId: general.id, mailbox: 9999, text: `${clockPhase} 공개 메시지` })
            ).resolves.toMatchObject({ msgType: 'public' });
            expect(queryRaw).toHaveBeenCalledOnce();
        }
    );

    it.each(['SUSPENDED', 'RECONCILING'] as const)(
        'keeps a received recruitment letter visible with its frozen game deadline while the clock is %s',
        async (clockPhase) => {
            const scoutRow = {
                id: 54,
                mailbox: general.id,
                type: 'private',
                src: 8,
                dest: general.id,
                time: new Date('0200-01-01T00:00:00.000Z'),
                created_at_wall: new Date('2026-09-03T15:00:00.000Z'),
                action_status: 'PENDING',
                expires_game_tick: 200n,
                message: {
                    src: {
                        generalId: 8,
                        generalName: '등용권유자',
                        nationId: 2,
                        nationName: '촉',
                        color: '#000',
                        icon: '',
                    },
                    dest: {
                        generalId: general.id,
                        generalName: general.name,
                        nationId: general.nationId,
                        nationName: '위',
                        color: '#fff',
                        icon: '',
                    },
                    text: '등용 권유 서신',
                    option: { action: 'scout' },
                },
            };
            const { caller } = buildContext({
                $queryRaw: vi.fn(async () => [scoutRow]),
                worldState: {
                    findFirst: vi.fn(async () => ({
                        clockBaseTime: new Date('0200-01-01T00:00:00.000Z'),
                        clockTick: 100n,
                        clockMode: 'realtime',
                        clockWallAnchor: new Date('2026-09-03T15:00:00.000Z'),
                        tickSeconds: 600,
                        clockPhase,
                        clockRevision: 9n,
                        deadlineGeneration: 4n,
                    })),
                },
            });

            const result = await caller.messages.getRecent({ generalId: general.id });

            expect(result.private[0]).toMatchObject({
                id: scoutRow.id,
                text: '등용 권유 서신',
                option: { action: 'scout' },
                time: '2026-09-03 15:00:00',
            });
            expect(result.private[0]?.option).not.toMatchObject({ invalid: true });
        }
    );

    it('allows an ambassador to target a foreign nation mailbox as diplomacy', async () => {
        const ambassador = {
            ...general,
            officerLevel: 1,
            meta: { permission: 'ambassador' },
        } as GeneralRow;
        const queryRaw = vi.fn(async () => [{ id: 52 }]);
        const { caller } = buildContext({
            $queryRaw: queryRaw,
            general: {
                findUnique: vi.fn(async () => ambassador),
                findMany: vi.fn(async () => []),
            },
            nation: {
                findMany: vi.fn(async () => []),
                findUnique: vi.fn(async ({ where }: { where: { id: number } }) => ({
                    id: where.id,
                    name: where.id === 1 ? '위' : '촉',
                    color: '#112233',
                    meta: {},
                })),
            },
        });

        const result = await caller.messages.send({
            generalId: ambassador.id,
            mailbox: 9002,
            text: '외교 메시지',
        });

        expect(result.msgType).toBe('diplomacy');
        expect(queryRaw).toHaveBeenCalledTimes(2);
    });

    it('allows a ruler to send a recruitment advertisement to the wanderer mailbox', async () => {
        const ruler = { ...general, officerLevel: 12 } as GeneralRow;
        const queryRaw = vi.fn(async () => [{ id: 53 }]);
        const changeJournal = new ChangeJournal();
        const { caller } = buildContext(
            {
                $queryRaw: queryRaw,
                general: {
                    findUnique: vi.fn(async () => ruler),
                    findMany: vi.fn(async () => []),
                },
                nation: {
                    findMany: vi.fn(async () => []),
                    findUnique: vi.fn(async () => ({ id: 1, name: '위', color: '#112233', meta: {} })),
                },
            },
            { changeJournal }
        );

        const result = await caller.messages.send({
            generalId: ruler.id,
            mailbox: 9000,
            text: '우리 나라로 와주세요',
        });

        expect(result.msgType).toBe('diplomacy');
        expect(queryRaw).toHaveBeenCalledTimes(2);
        expect(changeJournal.snapshot()).toEqual([
            { domain: 'messages.mailbox', entityId: 9000 },
            { domain: 'messages.mailbox', entityId: 9001 },
        ]);
    });

    it('keeps the wanderer mailbox unavailable to a non-diplomat on the server', async () => {
        const queryRaw = vi.fn(async () => [{ id: 54 }]);
        const { caller } = buildContext({
            $queryRaw: queryRaw,
            nation: {
                findMany: vi.fn(async () => []),
                findUnique: vi.fn(async () => ({ id: 1, name: '위', color: '#112233', meta: {} })),
            },
        });

        const result = await caller.messages.send({
            generalId: general.id,
            mailbox: 9000,
            text: '권한 없는 재야 광고',
        });

        expect(result.msgType).toBe('national');
        expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it('shows a wanderer the advertisement stored in mailbox 9000 without diplomacy redaction', async () => {
        const wanderer = { ...general, nationId: 0, officerLevel: 0 } as GeneralRow;
        const advertisementRow = {
            id: 55,
            mailbox: 9000,
            type: 'diplomacy',
            src: 9001,
            dest: 9000,
            time: new Date(),
            valid_until: new Date('9999-12-31T00:00:00Z'),
            message: {
                src: {
                    generalId: 1,
                    generalName: '위왕',
                    nationId: 1,
                    nationName: '위',
                    color: '#112233',
                    icon: '',
                },
                dest: {
                    generalId: 0,
                    generalName: '',
                    nationId: 0,
                    nationName: '재야',
                    color: '#000000',
                    icon: '',
                },
                text: '우리 나라로 와주세요',
                option: {},
            },
        };
        const queryRaw = vi.fn(async (...args: unknown[]) => {
            const values = args.slice(1);
            return values.includes(9000) && values.includes('diplomacy') ? [advertisementRow] : [];
        });
        const { caller } = buildContext({
            $queryRaw: queryRaw,
            general: {
                findUnique: vi.fn(async () => wanderer),
                findMany: vi.fn(async () => []),
            },
        });

        const result = await caller.messages.getRecent({ generalId: wanderer.id });

        expect(result.permission).toBe(-1);
        expect(result.diplomacy).toEqual([
            expect.objectContaining({
                text: '우리 나라로 와주세요',
                dest: expect.objectContaining({ nationId: 0, nationName: '재야' }),
                option: {},
            }),
        ]);
    });

    it('blocks private messages between foreign ambassadors', async () => {
        const ambassador = {
            ...general,
            officerLevel: 1,
            meta: { permission: 'ambassador' },
        } as GeneralRow;
        const foreignAmbassador = {
            ...ambassador,
            id: 8,
            userId: 'user-8',
            name: '상대 외교관',
            nationId: 2,
        } as GeneralRow;
        const { caller } = buildContext({
            general: {
                findUnique: vi.fn(async ({ where }: { where: { id: number } }) =>
                    where.id === ambassador.id ? ambassador : foreignAmbassador
                ),
                findMany: vi.fn(async () => []),
            },
            nation: {
                findMany: vi.fn(async () => []),
                findUnique: vi.fn(async ({ where }: { where: { id: number } }) => ({
                    id: where.id,
                    name: where.id === 1 ? '위' : '촉',
                    color: '#112233',
                    meta: {},
                })),
            },
        });

        await expect(
            caller.messages.send({
                generalId: ambassador.id,
                mailbox: foreignAmbassador.id,
                text: '개인 메시지',
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
            message: '외교권자끼리는 메시지를 보낼 수 없습니다.',
        });
    });

    it.each([
        ['public', { noSendPublicMsg: 1 }, 9999, '공개 메세지를 보낼 수 없습니다.'],
        ['private', { noSendPrivateMsg: 1 }, 8, '개인 메세지를 보낼 수 없습니다.'],
    ])('enforces the general %s-message penalty', async (_type, penalty, mailbox, message) => {
        const penalized = { ...general, penalty } as GeneralRow;
        const { caller } = buildContext({
            general: {
                findUnique: vi.fn(async () => penalized),
                findMany: vi.fn(async () => []),
            },
            nation: {
                findMany: vi.fn(async () => []),
                findUnique: vi.fn(async () => ({ id: 1, name: '위', color: '#fff', meta: {} })),
            },
        });

        await expect(
            caller.messages.send({
                generalId: penalized.id,
                mailbox,
                text: '차단 메시지',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN', message });
    });

    it('enforces the legacy private-message interval through Redis without touching lifecycle', async () => {
        const redis = {
            set: vi.fn(async () => null),
            publish: vi.fn(async () => 1),
        };
        const { caller } = buildContext(
            {
                nation: {
                    findMany: vi.fn(async () => []),
                    findUnique: vi.fn(async () => ({ id: 1, name: '위', color: '#fff', meta: {} })),
                },
            },
            { redis }
        );

        await expect(
            caller.messages.send({
                generalId: general.id,
                mailbox: 8,
                text: '너무 빠른 메시지',
            })
        ).rejects.toMatchObject({
            code: 'TOO_MANY_REQUESTS',
            message: '개인메세지는 2초당 1건만 보낼 수 있습니다!',
        });
    });

    it('blocks sends for a muted authenticated user independently of general permission', async () => {
        const mutedAuth = {
            ...auth,
            sanctions: { mutedUntil: '2099-01-01T00:00:00.000Z' },
        };
        const { caller } = buildContext({}, { auth: mutedAuth });

        await expect(
            caller.messages.send({
                generalId: general.id,
                mailbox: 9999,
                text: '사용자 mute',
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
            message: '메시지 전송이 제한된 계정입니다.',
        });
    });

    it.each(['message', 'messages'])('blocks sends for the profile feature alias %s', async (feature) => {
        const restrictedAuth = {
            ...auth,
            sanctions: {
                serverRestrictions: {
                    'che:default': {
                        blockedFeatures: [feature],
                    },
                },
            },
        };
        const { caller } = buildContext({}, { auth: restrictedAuth });

        await expect(
            caller.messages.send({
                generalId: general.id,
                mailbox: 9999,
                text: 'profile restriction',
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
            message: '메시지 전송이 제한된 계정입니다.',
        });
    });

    it('rejects every remaining general-scoped message mutation for another user general', async () => {
        const foreignGeneral = { ...general, userId: 'user-8' } as GeneralRow;
        const { caller } = buildContext({
            general: {
                findUnique: vi.fn(async () => foreignGeneral),
                findMany: vi.fn(async () => []),
            },
        });

        await expect(caller.messages.getContacts({ generalId: foreignGeneral.id })).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(
            caller.messages.readLatest({
                generalId: foreignGeneral.id,
                type: 'private',
                messageId: 1,
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(caller.messages.delete({ generalId: foreignGeneral.id, messageId: 1 })).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(
            caller.messages.respond({
                generalId: foreignGeneral.id,
                messageId: 1,
                response: true,
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
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
        let rawCall = 0;
        const queryRaw = vi.fn(async () => {
            rawCall += 1;
            if (rawCall > 1) return [{ id: 21 }, { id: 22 }];
            return [
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
            ];
        });
        const changeJournal = new ChangeJournal();
        const { caller, executeRaw, updateMany } = buildContext({ $queryRaw: queryRaw }, { changeJournal });

        const result = await caller.messages.delete({ generalId: general.id, messageId: 21 });

        expect(result.deletedIds).toEqual([21, 22]);
        expect(queryRaw).toHaveBeenCalledTimes(2);
        expect(executeRaw).not.toHaveBeenCalled();
        expect(updateMany).not.toHaveBeenCalled();
        expect(changeJournal.snapshot()).toEqual([
            { domain: 'messages.mailbox', entityId: 7 },
            { domain: 'messages.mailbox', entityId: 8 },
        ]);
    });

    it('lets the sender delete a manual diplomacy copy without deleting the receiver copy', async () => {
        let rawCall = 0;
        const queryRaw = vi.fn(async () => {
            rawCall += 1;
            if (rawCall > 1) return [{ id: 25 }];
            return [
                {
                    id: 25,
                    mailbox: 9001,
                    type: 'diplomacy',
                    src: 9001,
                    dest: 9002,
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
                            generalId: 0,
                            generalName: '',
                            nationId: 2,
                            nationName: '촉',
                            color: '#000',
                            icon: '',
                        },
                        text: '일반 외교 메시지',
                        option: { receiverMessageID: 26 },
                    },
                },
            ];
        });
        const { caller, executeRaw, updateMany } = buildContext({ $queryRaw: queryRaw });

        const result = await caller.messages.delete({ generalId: general.id, messageId: 25 });

        expect(result.deletedIds).toEqual([25]);
        expect(queryRaw).toHaveBeenCalledTimes(2);
        expect(executeRaw).not.toHaveBeenCalled();
        expect(updateMany).not.toHaveBeenCalled();
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

    it.each(['scout', 'raiseInvader'] as const)(
        'dispatches a private %s response through the durable engine command',
        async (action) => {
            const messageRow = {
                id: 29,
                mailbox: general.id,
                type: 'private',
                src: 8,
                dest: general.id,
                time: new Date(),
                valid_until: new Date('9999-12-31T00:00:00Z'),
                message: {
                    src: {
                        generalId: 8,
                        generalName: '제안자',
                        nationId: 2,
                        nationName: '촉',
                        color: '#000',
                        icon: '',
                    },
                    dest: {
                        generalId: general.id,
                        generalName: general.name,
                        nationId: general.nationId,
                        nationName: '위',
                        color: '#fff',
                        icon: '',
                    },
                    text: '응답할 메시지',
                    option: { action },
                },
            };
            const requestCommand = vi.fn(async () => ({
                type: 'messageRespond' as const,
                ok: true,
                generalId: general.id,
                messageId: messageRow.id,
                action,
                reason: 'success',
            }));
            const { caller } = buildContext(
                { $queryRaw: vi.fn(async () => [messageRow]) },
                { turnDaemon: { requestCommand } }
            );

            const result = await caller.messages.respond({
                generalId: general.id,
                messageId: messageRow.id,
                response: true,
            });

            expect(result).toEqual({ result: true, reason: 'success' });
            expect(requestCommand).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'messageRespond',
                    userId: auth.user.id,
                    generalId: general.id,
                    messageId: messageRow.id,
                    response: true,
                })
            );
        }
    );

    const buildDiplomaticContext = (options?: {
        action?: 'noAggression' | 'cancelNA' | 'stopWar';
        actorNationId?: number;
        mailboxNationId?: number;
        proposerNationId?: number;
        proposerCurrentNationId?: number;
        proposerNationMeta?: Record<string, unknown>;
        diplomacyState?: number;
        response?: boolean;
        cities?: Array<{ id: number; nationId: number; frontState: number }>;
    }) => {
        const action = options?.action ?? 'noAggression';
        const actorNationId = options?.actorNationId ?? 1;
        const mailboxNationId = options?.mailboxNationId ?? actorNationId;
        const proposerNationId = options?.proposerNationId ?? 2;
        const actor = {
            ...general,
            cityId: 10,
            nationId: actorNationId,
            officerLevel: 12,
            meta: {},
            penalty: {},
        } as GeneralRow;
        const proposer = {
            ...general,
            id: 8,
            userId: 'user-8',
            name: '제안자',
            cityId: 20,
            nationId: options?.proposerCurrentNationId ?? proposerNationId,
            officerLevel: 12,
            meta: {},
            penalty: {},
        } as GeneralRow;
        const messageRow = {
            id: 31,
            mailbox: 9000 + mailboxNationId,
            type: 'diplomacy',
            src: 9000 + proposerNationId,
            dest: 9000 + actorNationId,
            time: new Date(),
            valid_until: new Date('9999-12-31T00:00:00Z'),
            message: {
                src: {
                    generalId: proposer.id,
                    generalName: proposer.name,
                    nationId: proposerNationId,
                    nationName: '촉',
                    color: '#000',
                    icon: '',
                },
                dest: {
                    generalId: actor.id,
                    generalName: actor.name,
                    nationId: actorNationId,
                    nationName: '위',
                    color: '#fff',
                    icon: '',
                },
                text: '외교 제안',
                option: {
                    action,
                    ...(action === 'noAggression' ? { year: 201, month: 2 } : {}),
                },
            },
        };
        let rawCall = 0;
        let insertedId = 100;
        const queryRaw = vi.fn(async () => {
            rawCall += 1;
            if (rawCall <= 2) {
                return [messageRow];
            }
            if (rawCall >= 5) {
                insertedId += 1;
                return [{ id: insertedId }];
            }
            return [];
        });
        const diplomacyState = options?.diplomacyState ?? (action === 'cancelNA' ? 7 : action === 'stopWar' ? 0 : 2);
        const diplomacyRows = [
            {
                id: 1,
                srcNationId: actorNationId,
                destNationId: proposerNationId,
                stateCode: diplomacyState,
                term: 6,
                isDead: false,
                isShowing: true,
                meta: {},
                createdAt: new Date(),
            },
            {
                id: 2,
                srcNationId: proposerNationId,
                destNationId: actorNationId,
                stateCode: diplomacyState,
                term: 6,
                isDead: false,
                isShowing: true,
                meta: {},
                createdAt: new Date(),
            },
        ];
        const diplomacyUpdate = vi.fn(
            async ({
                where,
                data,
            }: {
                where: { srcNationId_destNationId: { srcNationId: number; destNationId: number } };
                data: { stateCode?: number; term?: number };
            }) => {
                const row = diplomacyRows.find(
                    (entry) =>
                        entry.srcNationId === where.srcNationId_destNationId.srcNationId &&
                        entry.destNationId === where.srcNationId_destNationId.destNationId
                );
                if (row) {
                    if (data.stateCode !== undefined) row.stateCode = data.stateCode;
                    if (data.term !== undefined) row.term = data.term;
                }
                return {};
            }
        );
        const nationUpdate = vi.fn(async () => ({}));
        const logCreateMany = vi.fn(async () => ({ count: 1 }));
        const messageUpdateMany = vi.fn(async () => ({ count: 1 }));
        const messageActionUpdateMany = vi.fn(async () => ({ count: 1 }));
        const cityUpdate = vi.fn(async () => ({}));
        const changeJournal = new ChangeJournal();
        const { caller } = buildContext(
            {
                general: {
                    findUnique: vi.fn(async ({ where }: { where: { id: number } }) =>
                        where.id === actor.id ? actor : where.id === proposer.id ? proposer : null
                    ),
                    findMany: vi.fn(async () => []),
                },
                nation: {
                    findUnique: vi.fn(async ({ where }: { where: { id: number } }) =>
                        where.id === actorNationId
                            ? {
                                  id: actorNationId,
                                  name: '위',
                                  color: '#fff',
                                  capitalCityId: 10,
                                  chiefGeneralId: actor.id,
                                  gold: 1000,
                                  rice: 1000,
                                  tech: 0,
                                  level: 1,
                                  typeCode: 'test',
                                  meta: {},
                              }
                            : where.id === proposerNationId
                              ? {
                                    id: proposerNationId,
                                    name: '촉',
                                    color: '#000',
                                    capitalCityId: 20,
                                    chiefGeneralId: proposer.id,
                                    gold: 1000,
                                    rice: 1000,
                                    tech: 0,
                                    level: 1,
                                    typeCode: 'test',
                                    meta: options?.proposerNationMeta ?? {
                                        recv_assist: { [`n${actorNationId}`]: [actorNationId, 50] },
                                    },
                                }
                              : null
                    ),
                    findMany: vi.fn(async () => []),
                    update: nationUpdate,
                },
                city: {
                    findUnique: vi.fn(async () => ({
                        id: 10,
                        nationId: actorNationId,
                        supplyState: 1,
                    })),
                    findMany: vi.fn(async () => options?.cities ?? []),
                    update: cityUpdate,
                },
                diplomacy: {
                    findUnique: vi.fn(
                        async ({
                            where,
                        }: {
                            where: { srcNationId_destNationId: { srcNationId: number; destNationId: number } };
                        }) =>
                            diplomacyRows.find(
                                (row) =>
                                    row.srcNationId === where.srcNationId_destNationId.srcNationId &&
                                    row.destNationId === where.srcNationId_destNationId.destNationId
                            ) ?? null
                    ),
                    findMany: vi.fn(async () => diplomacyRows),
                    update: diplomacyUpdate,
                },
                worldState: {
                    findFirst: vi.fn(async () => ({
                        currentYear: 200,
                        currentMonth: 3,
                        config: { environment: { mapName: 'che' } },
                        clockBaseTime: new Date('0200-03-01T00:00:00.000Z'),
                        clockTick: 1_000n,
                        clockMode: 'manual',
                        clockWallAnchor: new Date('2026-09-03T00:00:00.000Z'),
                        tickSeconds: 600,
                        clockPhase: 'RUNNING',
                        clockRevision: 1n,
                        deadlineGeneration: 1n,
                    })),
                },
                logEntry: { createMany: logCreateMany },
                message: { updateMany: messageUpdateMany },
                messageAction: { updateMany: messageActionUpdateMany },
                $queryRaw: queryRaw,
            },
            { changeJournal }
        );
        return {
            caller,
            actor,
            proposer,
            queryRaw,
            diplomacyUpdate,
            nationUpdate,
            logCreateMany,
            messageUpdateMany,
            cityUpdate,
            changeJournal,
        };
    };

    it('accepts a diplomatic prompt atomically and applies the legacy non-aggression effects', async () => {
        const setup = buildDiplomaticContext();

        const result = await setup.caller.messages.respond({
            generalId: setup.actor.id,
            messageId: 31,
            response: true,
        });

        expect(result).toEqual({ result: true, reason: 'success' });
        expect(setup.diplomacyUpdate).toHaveBeenCalledTimes(2);
        expect(setup.nationUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 2 },
                data: {
                    meta: {
                        recv_assist: { n1: [1, 50] },
                        resp_assist: { n1: [1, 50] },
                    },
                },
            })
        );
        expect(setup.messageUpdateMany).toHaveBeenCalledWith({
            where: { id: { in: [31] } },
            data: { validUntil: expect.any(Date), validUntilTick: 1_000n },
        });
        expect(setup.queryRaw).toHaveBeenCalledTimes(9);
    });

    it('declines a diplomatic prompt without changing diplomacy', async () => {
        const setup = buildDiplomaticContext({ action: 'stopWar' });

        const result = await setup.caller.messages.respond({
            generalId: setup.actor.id,
            messageId: 31,
            response: false,
        });

        expect(result).toEqual({ result: true, reason: 'success' });
        expect(setup.diplomacyUpdate).not.toHaveBeenCalled();
        expect(setup.messageUpdateMany).toHaveBeenCalledOnce();
        expect(setup.logCreateMany).toHaveBeenCalledOnce();
    });

    it('permanently records rejection of an NPC aid-based non-aggression proposal', async () => {
        const setup = buildDiplomaticContext({
            proposerNationMeta: {
                recv_assist: { n1: [1, 50] },
                resp_assist_try: { n1: [1, 2402, 108_000_000] },
            },
        });

        const result = await setup.caller.messages.respond({
            generalId: setup.actor.id,
            messageId: 31,
            response: false,
        });

        expect(result).toEqual({ result: true, reason: 'success' });
        expect(setup.diplomacyUpdate).not.toHaveBeenCalled();
        expect(setup.nationUpdate).toHaveBeenCalledWith({
            where: { id: 2 },
            data: {
                meta: {
                    recv_assist: { n1: [1, 50] },
                    resp_assist_try: { n1: [1, 2402, 108_000_000] },
                    resp_assist_declined: { n1: [1, 2402] },
                },
            },
        });
        expect(setup.messageUpdateMany).toHaveBeenCalledOnce();
    });

    it('does not record a permanent aid rejection for a manual non-aggression proposal', async () => {
        const setup = buildDiplomaticContext({ proposerNationMeta: {} });

        const result = await setup.caller.messages.respond({
            generalId: setup.actor.id,
            messageId: 31,
            response: false,
        });

        expect(result).toEqual({ result: true, reason: 'success' });
        expect(setup.nationUpdate).not.toHaveBeenCalled();
        expect(setup.messageUpdateMany).toHaveBeenCalledOnce();
    });

    it.each([
        ['cancelNA' as const, 7],
        ['stopWar' as const, 0],
    ])('accepts the %s prompt through the same runtime path', async (action, diplomacyState) => {
        const setup = buildDiplomaticContext({
            action,
            diplomacyState,
            ...(action === 'stopWar'
                ? {
                      cities: [
                          { id: 1, nationId: 1, frontState: 3 },
                          { id: 9, nationId: 2, frontState: 3 },
                      ],
                  }
                : {}),
        });

        const result = await setup.caller.messages.respond({
            generalId: setup.actor.id,
            messageId: 31,
            response: true,
        });

        expect(result).toEqual({ result: true, reason: 'success' });
        expect(setup.diplomacyUpdate).toHaveBeenCalledTimes(2);
        if (action === 'stopWar') {
            expect(setup.cityUpdate).toHaveBeenCalledTimes(2);
            expect(setup.cityUpdate).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { frontState: 0 },
            });
            expect(setup.cityUpdate).toHaveBeenCalledWith({
                where: { id: 9 },
                data: { frontState: 0 },
            });
            expect(setup.changeJournal.snapshot()).toEqual([
                { domain: 'city.content', entityId: 1 },
                { domain: 'city.content', entityId: 9 },
                { domain: 'dashboard.global', entityId: 0 },
                { domain: 'map.world', entityId: 0 },
                { domain: 'messages.mailbox', entityId: 9001 },
                { domain: 'messages.mailbox', entityId: 9002 },
                { domain: 'nation.content', entityId: 1 },
                { domain: 'nation.content', entityId: 2 },
                { domain: 'records.general', entityId: 7 },
                { domain: 'records.general', entityId: 8 },
            ]);
        }
    });

    it('rejects a prompt when the proposer has left the proposing nation', async () => {
        const setup = buildDiplomaticContext({ proposerCurrentNationId: 3 });

        const result = await setup.caller.messages.respond({
            generalId: setup.actor.id,
            messageId: 31,
            response: true,
        });

        expect(result).toEqual({ result: false, reason: '제의 장수가 국가 소속이 아닙니다' });
        expect(setup.diplomacyUpdate).not.toHaveBeenCalled();
        expect(setup.messageUpdateMany).not.toHaveBeenCalled();
        expect(setup.logCreateMany).toHaveBeenCalledOnce();
    });

    it('does not let another nation process the diplomatic inbox row', async () => {
        const setup = buildDiplomaticContext({ mailboxNationId: 2 });

        const result = await setup.caller.messages.respond({
            generalId: setup.actor.id,
            messageId: 31,
            response: true,
        });

        expect(result).toEqual({
            result: false,
            reason: '송신자가 외교서신을 처리할 수 없습니다.',
        });
        expect(setup.diplomacyUpdate).not.toHaveBeenCalled();
        expect(setup.messageUpdateMany).not.toHaveBeenCalled();
    });
});
