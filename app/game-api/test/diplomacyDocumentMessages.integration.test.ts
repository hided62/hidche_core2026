import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JosaUtil } from '@sammo-ts/common';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { createGamePostgresConnector, type GamePrismaClient, type RedisConnector } from '@sammo-ts/infra';
import {
    MESSAGE_MAILBOX_NATIONAL_BASE,
    type MessagePayload,
    type MessageTarget,
    type MessageType,
} from '@sammo-ts/logic';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import type { GameApiContext } from '../src/context.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { appRouter } from '../src/router.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const fixtureNationId = 841;
const foreignNationId = fixtureNationId + 1;
const fixtureGeneralId = 8_864_243;
const foreignGeneralId = fixtureGeneralId + 1;
const fixtureWorldStateId = -8_864_241;
const fixtureUserId = 'diplomacy-document-message-src-user';
const foreignUserId = 'diplomacy-document-message-dest-user';
const requestPrefix = 'integration:diplomacy-document-message';
const fixtureMailboxes = [
    MESSAGE_MAILBOX_NATIONAL_BASE + fixtureNationId,
    MESSAGE_MAILBOX_NATIONAL_BASE + foreignNationId,
] as const;
const clockBaseTime = new Date('0208-04-05T06:07:08.000Z');
const logicalGameTime = new Date('0208-04-05T06:17:08.000Z');
const logicalGameTick = 36_000_000n;

const buildAuth = (userId: string, sessionSuffix: string): GameSessionTokenPayload => ({
    version: 1,
    profile: 'che:diplomacy-document-message',
    issuedAt: '2026-08-24T00:00:00.000Z',
    expiresAt: '2027-08-24T00:00:00.000Z',
    sessionId: `diplomacy-document-message-${sessionSuffix}`,
    user: {
        id: userId,
        username: userId,
        displayName: userId,
        roles: ['user'],
    },
    sanctions: {},
});

const fixtureAuth = buildAuth(fixtureUserId, 'src');
const foreignAuth = buildAuth(foreignUserId, 'dest');

const isFixtureOutboxPayload = (payload: unknown): boolean => {
    if (!payload || typeof payload !== 'object' || !('changes' in payload)) return false;
    const changes = (payload as { changes?: unknown }).changes;
    return (
        Array.isArray(changes) &&
        changes.some(
            (change) =>
                Array.isArray(change) &&
                change[0] === 'messages.mailbox' &&
                fixtureMailboxes.includes(change[1] as (typeof fixtureMailboxes)[number])
        )
    );
};

integration('diplomacy document message persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const deleteFixtureOutboxes = async (): Promise<void> => {
        const rows = await db.readModelOutbox.findMany({ select: { id: true, payload: true } });
        const ids = rows.filter(({ payload }) => isFixtureOutboxPayload(payload)).map(({ id }) => id);
        if (ids.length > 0) {
            await db.readModelOutbox.deleteMany({ where: { id: { in: ids } } });
        }
    };

    const cleanupRouteState = async (): Promise<void> => {
        await db.message.deleteMany({ where: { mailbox: { in: [...fixtureMailboxes] } } });
        await db.diplomacyLetter.deleteMany({
            where: {
                OR: [
                    { srcNationId: { in: [fixtureNationId, foreignNationId] } },
                    { destNationId: { in: [fixtureNationId, foreignNationId] } },
                ],
            },
        });
        await db.inputEvent.deleteMany({ where: { requestId: { startsWith: requestPrefix } } });
        await deleteFixtureOutboxes();
        await db.readModelRevision.deleteMany({
            where: { domain: 'messages.mailbox', entityId: { in: [...fixtureMailboxes] } },
        });
    };

    const cleanupFixture = async (): Promise<void> => {
        await cleanupRouteState();
        await db.general.deleteMany({ where: { id: { in: [fixtureGeneralId, foreignGeneralId] } } });
        await db.nation.deleteMany({ where: { id: { in: [fixtureNationId, foreignNationId] } } });
        await db.worldState.deleteMany({ where: { id: fixtureWorldStateId } });
    };

    const buildContext = (
        requestId: string,
        auth: GameSessionTokenPayload,
        database: GameApiContext['db'] = db
    ): GameApiContext => {
        const redisClient = {
            get: async () => null,
            set: async () => null,
            publish: async () => 0,
        } as unknown as RedisConnector['client'];
        return {
            requestId: `${requestPrefix}:${requestId}`,
            db: database,
            redis: redisClient,
            turnDaemon: new InMemoryTurnDaemonTransport(),
            battleSim: new InMemoryBattleSimTransport(),
            profile: {
                id: 'che',
                scenario: 'diplomacy-document-message',
                name: 'che:diplomacy-document-message',
            },
            uploadDir: 'uploads',
            uploadPath: '/uploads',
            uploadPublicUrl: null,
            auth,
            accessTokenStore: new RedisAccessTokenStore(redisClient, 'che:diplomacy-document-message'),
            flushStore: new InMemoryFlushStore(),
            gameTokenSecret: 'diplomacy-document-message-secret',
        };
    };

    const createLetter = async (
        options: {
            state?: 'PROPOSED' | 'ACTIVATED';
            srcNationId?: number;
            destNationId?: number;
            srcSignerId?: number;
            destSignerId?: number | null;
        } = {}
    ) => {
        const srcNationId = options.srcNationId ?? fixtureNationId;
        const destNationId = options.destNationId ?? foreignNationId;
        const srcSignerId = options.srcSignerId ?? fixtureGeneralId;
        const state = options.state ?? 'PROPOSED';
        return db.diplomacyLetter.create({
            data: {
                srcNationId,
                destNationId,
                state,
                textBrief: '통합 외교문서',
                textDetail: '통합 외교문서 상세',
                date: logicalGameTime,
                srcSignerId,
                destSignerId:
                    options.destSignerId === undefined
                        ? state === 'ACTIVATED'
                            ? foreignGeneralId
                            : null
                        : options.destSignerId,
                aux: {
                    src: {
                        nationName: srcNationId === fixtureNationId ? '원민국' : '상대국',
                        nationColor: srcNationId === fixtureNationId ? '#123456' : '#654321',
                        generalId: srcSignerId,
                        generalName: srcSignerId === fixtureGeneralId ? '원민수뇌' : '상대수뇌',
                    },
                    dest: {
                        nationName: destNationId === fixtureNationId ? '원민국' : '상대국',
                        nationColor: destNationId === fixtureNationId ? '#123456' : '#654321',
                    },
                },
            },
        });
    };

    const expectInputEvent = async (requestId: string, route: string, actorUserId: string): Promise<void> => {
        await expect(
            db.inputEvent.findUniqueOrThrow({
                where: { requestId: `${requestPrefix}:${requestId}:diplomacy.${route}` },
            })
        ).resolves.toMatchObject({
            target: 'API',
            eventType: `diplomacy.${route}`,
            actorUserId,
            status: 'SUCCEEDED',
            attempts: 1,
        });
    };

    const expectNoticeCopies = async (options: {
        text: string;
        types: readonly MessageType[];
        src: Pick<MessageTarget, 'generalId' | 'generalName' | 'nationId' | 'nationName'>;
        dest: Pick<MessageTarget, 'generalId' | 'generalName' | 'nationId' | 'nationName'>;
    }): Promise<void> => {
        const allRows = await db.message.findMany({
            where: { mailbox: { in: [...fixtureMailboxes] } },
            orderBy: { id: 'asc' },
        });
        const srcMailbox = MESSAGE_MAILBOX_NATIONAL_BASE + options.src.nationId;
        const destMailbox = MESSAGE_MAILBOX_NATIONAL_BASE + options.dest.nationId;

        for (const type of options.types) {
            const rows = allRows.filter((row) => {
                const payload = row.message as unknown as MessagePayload;
                return row.type === type && payload.text === options.text;
            });
            expect(rows, `${type}: ${options.text}`).toHaveLength(2);
            expect(rows.map(({ mailbox }) => mailbox).sort((left, right) => left - right)).toEqual(
                [srcMailbox, destMailbox].sort((left, right) => left - right)
            );

            const receiver = rows.find(({ mailbox }) => mailbox === destMailbox);
            const sender = rows.find(({ mailbox }) => mailbox === srcMailbox);
            expect(receiver).toBeDefined();
            expect(sender).toBeDefined();

            for (const row of rows) {
                const payload = row.message as unknown as MessagePayload;
                expect(row).toMatchObject({
                    type,
                    src: srcMailbox,
                    dest: destMailbox,
                    time: logicalGameTime,
                    timeTick: logicalGameTick,
                });
                expect(payload).toMatchObject({
                    src: options.src,
                    dest: options.dest,
                    text: options.text,
                    option: { deletable: false },
                });
                expect(payload.option?.deletable).toBe(false);
            }

            const receiverPayload = receiver?.message as unknown as MessagePayload;
            const senderPayload = sender?.message as unknown as MessagePayload;
            expect(receiverPayload.option).toEqual({ deletable: false });
            expect(senderPayload.option).toMatchObject({
                deletable: false,
                receiverMessageID: receiver?.id,
            });
        }
    };

    const buildRollbackDatabase = (failure: Error): GameApiContext['db'] => {
        const database = db as unknown as GameApiContext['db'];
        return new Proxy(database, {
            get(target, property) {
                if (property === '$transaction') {
                    return async (callback: (transaction: GameApiContext['db']) => Promise<unknown>) =>
                        db.$transaction(async (transaction) => {
                            await callback(transaction as unknown as GameApiContext['db']);
                            throw failure;
                        });
                }
                return Reflect.get(target, property, target);
            },
        });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await cleanupFixture();
        await db.worldState.create({
            data: {
                id: fixtureWorldStateId,
                scenarioCode: 'diplomacy-document-message',
                currentYear: 208,
                currentMonth: 4,
                tickSeconds: 600,
                clockBaseTime,
                clockTick: logicalGameTick,
                clockMode: 'manual',
                clockWallAnchor: new Date('2026-08-24T00:00:00.000Z'),
                config: {},
                meta: {},
            },
        });
        await db.nation.createMany({
            data: [
                { id: fixtureNationId, name: '원민국', color: '#123456' },
                { id: foreignNationId, name: '상대국', color: '#654321' },
            ],
        });
        await db.general.createMany({
            data: [
                {
                    id: fixtureGeneralId,
                    userId: fixtureUserId,
                    name: '원민수뇌',
                    nationId: fixtureNationId,
                    officerLevel: 12,
                    picture: 'src.png',
                    imageServer: 0,
                    turnTime: logicalGameTime,
                },
                {
                    id: foreignGeneralId,
                    userId: foreignUserId,
                    name: '상대수뇌',
                    nationId: foreignNationId,
                    officerLevel: 12,
                    picture: 'dest.png',
                    imageServer: 0,
                    turnTime: logicalGameTime,
                },
            ],
        });
    });

    beforeEach(cleanupRouteState);
    afterEach(cleanupRouteState);

    afterAll(async () => {
        await cleanupFixture();
        await closeDb?.();
    });

    it('stores only diplomacy receiver/sender copies for new and chained documents', async () => {
        const firstRequestId = 'send-first';
        const first = await appRouter.createCaller(buildContext(firstRequestId, fixtureAuth)).diplomacy.sendLetter({
            destNationId: foreignNationId,
            brief: '첫 외교문서',
            detail: '첫 외교문서 상세',
        });
        const firstText = `새로운 외교 문서 #${first.id}${JosaUtil.pick(String(first.id), '이')} 준비되었습니다. 외교부에서 확인해주세요.`;
        await expectNoticeCopies({
            text: firstText,
            types: ['diplomacy'],
            src: {
                generalId: fixtureGeneralId,
                generalName: '원민수뇌',
                nationId: fixtureNationId,
                nationName: '원민국',
            },
            dest: { generalId: 0, generalName: '', nationId: foreignNationId, nationName: '상대국' },
        });
        await expectInputEvent(firstRequestId, 'sendLetter', fixtureUserId);

        const chainedRequestId = 'send-chained';
        const chained = await appRouter.createCaller(buildContext(chainedRequestId, fixtureAuth)).diplomacy.sendLetter({
            destNationId: foreignNationId,
            prevId: first.id,
            brief: '후속 외교문서',
            detail: '후속 외교문서 상세',
        });
        const chainedText = `문서 #${first.id}의 새로운 외교 문서 #${chained.id}${JosaUtil.pick(String(chained.id), '이')} 준비되었습니다. 외교부에서 확인해주세요.`;
        await expectNoticeCopies({
            text: chainedText,
            types: ['diplomacy'],
            src: {
                generalId: fixtureGeneralId,
                generalName: '원민수뇌',
                nationId: fixtureNationId,
                nationName: '원민국',
            },
            dest: { generalId: 0, generalName: '', nationId: foreignNationId, nationName: '상대국' },
        });
        expect(await db.message.count({ where: { mailbox: { in: [...fixtureMailboxes] } } })).toBe(4);
        await expectInputEvent(chainedRequestId, 'sendLetter', fixtureUserId);
    });

    it('stores diplomacy and national copies for both approval and rejection responses', async () => {
        const approved = await createLetter();
        const approveRequestId = 'respond-approve';
        await expect(
            appRouter
                .createCaller(buildContext(approveRequestId, foreignAuth))
                .diplomacy.respondLetter({ letterId: approved.id, agree: true })
        ).resolves.toEqual({ ok: true });
        await expectNoticeCopies({
            text: `외교 서신( #${approved.id})이 승인되었습니다.`,
            types: ['diplomacy', 'national'],
            src: {
                generalId: foreignGeneralId,
                generalName: '상대수뇌',
                nationId: foreignNationId,
                nationName: '상대국',
            },
            dest: { generalId: 0, generalName: '', nationId: fixtureNationId, nationName: '원민국' },
        });
        await expectInputEvent(approveRequestId, 'respondLetter', foreignUserId);

        const rejected = await createLetter();
        const rejectRequestId = 'respond-reject';
        await expect(
            appRouter.createCaller(buildContext(rejectRequestId, foreignAuth)).diplomacy.respondLetter({
                letterId: rejected.id,
                agree: false,
                reason: '조건 불충족',
            })
        ).resolves.toEqual({ ok: true });
        await expectNoticeCopies({
            text: `외교 서신(#${rejected.id})이 거부되었습니다. 이유 : 조건 불충족`,
            types: ['diplomacy', 'national'],
            src: {
                generalId: foreignGeneralId,
                generalName: '상대수뇌',
                nationId: foreignNationId,
                nationName: '상대국',
            },
            dest: { generalId: 0, generalName: '', nationId: fixtureNationId, nationName: '원민국' },
        });
        expect(await db.message.count({ where: { mailbox: { in: [...fixtureMailboxes] } } })).toBe(8);
        await expectInputEvent(rejectRequestId, 'respondLetter', foreignUserId);
    });

    it('stores diplomacy copies when the sender rolls a proposed document back', async () => {
        const letter = await createLetter();
        const requestId = 'rollback';
        await expect(
            appRouter
                .createCaller(buildContext(requestId, fixtureAuth))
                .diplomacy.rollbackLetter({ letterId: letter.id })
        ).resolves.toEqual({ ok: true });
        await expectNoticeCopies({
            text: `외교 서신(#${letter.id})이 회수되었습니다.`,
            types: ['diplomacy'],
            src: {
                generalId: fixtureGeneralId,
                generalName: '원민수뇌',
                nationId: fixtureNationId,
                nationName: '원민국',
            },
            dest: { generalId: 0, generalName: '', nationId: foreignNationId, nationName: '상대국' },
        });
        expect(await db.message.count({ where: { mailbox: { in: [...fixtureMailboxes] } } })).toBe(2);
        await expectInputEvent(requestId, 'rollbackLetter', fixtureUserId);
    });

    it('stores actor-directed diplomacy copies for the first and second destroy phases', async () => {
        const letter = await createLetter({ state: 'ACTIVATED' });
        const requestRequestId = 'destroy-request';
        await expect(
            appRouter
                .createCaller(buildContext(requestRequestId, fixtureAuth))
                .diplomacy.destroyLetter({ letterId: letter.id })
        ).resolves.toEqual({ state: 'ACTIVATED' });
        await expectNoticeCopies({
            text: `외교 서신(#${letter.id})을 파기 요청합니다.`,
            types: ['diplomacy'],
            src: {
                generalId: fixtureGeneralId,
                generalName: '원민수뇌',
                nationId: fixtureNationId,
                nationName: '원민국',
            },
            dest: { generalId: 0, generalName: '', nationId: foreignNationId, nationName: '상대국' },
        });
        await expectInputEvent(requestRequestId, 'destroyLetter', fixtureUserId);

        const completeRequestId = 'destroy-complete';
        await expect(
            appRouter
                .createCaller(buildContext(completeRequestId, foreignAuth))
                .diplomacy.destroyLetter({ letterId: letter.id })
        ).resolves.toEqual({ state: 'CANCELLED' });
        await expectNoticeCopies({
            text: `외교 서신(#${letter.id})을 파기했습니다.`,
            types: ['diplomacy'],
            src: {
                generalId: foreignGeneralId,
                generalName: '상대수뇌',
                nationId: foreignNationId,
                nationName: '상대국',
            },
            dest: { generalId: 0, generalName: '', nationId: fixtureNationId, nationName: '원민국' },
        });
        expect(await db.message.count({ where: { mailbox: { in: [...fixtureMailboxes] } } })).toBe(4);
        await expectInputEvent(completeRequestId, 'destroyLetter', foreignUserId);
    });

    it('rolls letter and message writes back together while retaining the failed API input event', async () => {
        const failure = new Error('injected diplomacy message transaction rollback');
        const requestId = 'send-rollback';
        const rollbackDb = buildRollbackDatabase(failure);

        await expect(
            appRouter.createCaller(buildContext(requestId, fixtureAuth, rollbackDb)).diplomacy.sendLetter({
                destNationId: foreignNationId,
                brief: 'rollback 외교문서',
                detail: 'rollback 외교문서 상세',
            })
        ).rejects.toThrow(failure.message);

        await expect(db.diplomacyLetter.findFirst({ where: { textBrief: 'rollback 외교문서' } })).resolves.toBeNull();
        await expect(db.message.count({ where: { mailbox: { in: [...fixtureMailboxes] } } })).resolves.toBe(0);
        await expect(
            db.readModelRevision.count({
                where: { domain: 'messages.mailbox', entityId: { in: [...fixtureMailboxes] } },
            })
        ).resolves.toBe(0);
        await expect(
            db.inputEvent.findUniqueOrThrow({
                where: { requestId: `${requestPrefix}:${requestId}:diplomacy.sendLetter` },
            })
        ).resolves.toMatchObject({
            target: 'API',
            eventType: 'diplomacy.sendLetter',
            actorUserId: fixtureUserId,
            status: 'FAILED',
            attempts: 1,
            error: failure.message,
        });
    });
});
