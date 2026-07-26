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

    const buildDiplomaticContext = (options?: {
        action?: 'noAggression' | 'cancelNA' | 'stopWar';
        actorNationId?: number;
        mailboxNationId?: number;
        proposerNationId?: number;
        proposerCurrentNationId?: number;
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
            if (rawCall === 1) {
                return [messageRow];
            }
            if (rawCall >= 4) {
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
        const cityUpdate = vi.fn(async () => ({}));
        const { caller } = buildContext({
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
                                meta: { recv_assist: { [`n${actorNationId}`]: [actorNationId, 50] } },
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
                })),
            },
            logEntry: { createMany: logCreateMany },
            message: { updateMany: messageUpdateMany },
            $queryRaw: queryRaw,
        });
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
            data: { validUntil: expect.any(Date) },
        });
        expect(setup.queryRaw).toHaveBeenCalledTimes(8);
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
