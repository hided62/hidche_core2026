import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { createGamePostgresConnector, type GamePrismaClient, type RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import type { GameApiContext } from '../src/context.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { appRouter } from '../src/router.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actorGeneralId = 8_701;
const checkedGeneralId = 8_702;
const actorNationId = 871;
const checkedNationId = 872;
const actorUserId = 'inherit-owner-message-actor';
const checkedUserId = 'inherit-owner-message-checked';

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che:inherit-owner-message',
    issuedAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-20T00:00:00.000Z',
    sessionId: 'inherit-owner-message-session',
    user: {
        id: actorUserId,
        username: actorUserId,
        displayName: '확인자 계정',
        roles: ['user'],
    },
    sanctions: {},
};

const hasMailboxChange = (payload: unknown): boolean => {
    if (!payload || typeof payload !== 'object' || !('changes' in payload)) return false;
    const changes = (payload as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) return false;
    const mailboxes = new Set([actorGeneralId, checkedGeneralId]);
    return changes.some(
        (change) =>
            Array.isArray(change) &&
            change[0] === 'messages.mailbox' &&
            typeof change[1] === 'number' &&
            mailboxes.has(change[1])
    );
};

integration('inherit owner lookup private messages', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;
    let worldStateId: number;

    const buildContext = (requestId: string): GameApiContext => {
        const redisClient = {
            get: async () => null,
            set: async () => null,
        };
        return {
            requestId,
            db,
            redis: redisClient as unknown as RedisConnector['client'],
            turnDaemon: new InMemoryTurnDaemonTransport(),
            battleSim: new InMemoryBattleSimTransport(),
            profile: { id: 'che', scenario: 'inherit-owner-message', name: 'che:inherit-owner-message' },
            uploadDir: 'uploads',
            uploadPath: '/uploads',
            uploadPublicUrl: null,
            auth,
            accessTokenStore: new RedisAccessTokenStore(redisClient, 'che:inherit-owner-message'),
            flushStore: new InMemoryFlushStore(),
            gameTokenSecret: 'test-secret',
            readModelOutbox: { wake: vi.fn() },
        };
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();

        await db.inputEvent.deleteMany({ where: { actorUserId } });
        await db.message.deleteMany({ where: { mailbox: { in: [actorGeneralId, checkedGeneralId] } } });
        await db.inheritanceLog.deleteMany({ where: { userId: actorUserId } });
        await db.inheritancePoint.deleteMany({ where: { userId: actorUserId } });
        await db.general.deleteMany({ where: { id: { in: [actorGeneralId, checkedGeneralId] } } });
        await db.nation.deleteMany({ where: { id: { in: [actorNationId, checkedNationId] } } });
        await db.readModelRevision.deleteMany({
            where: { domain: 'messages.mailbox', entityId: { in: [actorGeneralId, checkedGeneralId] } },
        });

        await db.nation.createMany({
            data: [
                { id: actorNationId, name: '확인국', color: '#123456', level: 2 },
                { id: checkedNationId, name: '피확인국', color: '#654321', level: 3 },
            ],
        });
        await db.general.createMany({
            data: [
                {
                    id: actorGeneralId,
                    userId: actorUserId,
                    name: '확인장수',
                    nationId: actorNationId,
                    cityId: 1,
                    npcState: 0,
                    turnTime: new Date('0200-01-01T00:00:00.000Z'),
                    meta: { ownerName: '확인자 계정' },
                },
                {
                    id: checkedGeneralId,
                    userId: checkedUserId,
                    name: '피확인장수',
                    nationId: checkedNationId,
                    cityId: 1,
                    npcState: 0,
                    turnTime: new Date('0200-01-01T00:00:00.000Z'),
                    meta: { ownerName: '피확인 계정' },
                },
            ],
        });
        await db.inheritancePoint.create({
            data: { userId: actorUserId, key: 'previous', value: 1_500 },
        });
        const world = await db.worldState.create({
            data: {
                scenarioCode: 'inherit-owner-message',
                currentYear: 200,
                currentMonth: 4,
                tickSeconds: 600,
                config: { const: { inheritCheckOwnerPoint: 1_000 } },
                meta: { isUnited: 0 },
            },
        });
        worldStateId = world.id;
    });

    afterAll(async () => {
        const outboxes = await db.readModelOutbox.findMany({ select: { id: true, payload: true } });
        const outboxIds = outboxes.filter(({ payload }) => hasMailboxChange(payload)).map(({ id }) => id);
        if (outboxIds.length > 0) {
            await db.readModelOutbox.deleteMany({ where: { id: { in: outboxIds } } });
        }
        await db.inputEvent.deleteMany({ where: { actorUserId } });
        await db.message.deleteMany({ where: { mailbox: { in: [actorGeneralId, checkedGeneralId] } } });
        await db.inheritanceLog.deleteMany({ where: { userId: actorUserId } });
        await db.inheritancePoint.deleteMany({ where: { userId: actorUserId } });
        await db.general.deleteMany({ where: { id: { in: [actorGeneralId, checkedGeneralId] } } });
        await db.nation.deleteMany({ where: { id: { in: [actorNationId, checkedNationId] } } });
        await db.readModelRevision.deleteMany({
            where: { domain: 'messages.mailbox', entityId: { in: [actorGeneralId, checkedGeneralId] } },
        });
        await db.worldState.delete({ where: { id: worldStateId } });
        await closeDb?.();
    });

    it('commits the point charge, log, and both Ref-compatible private messages', async () => {
        const requestId = 'integration:inherit-owner-message:success';
        await expect(
            appRouter.createCaller(buildContext(requestId)).inherit.checkOwner({ targetGeneralId: checkedGeneralId })
        ).resolves.toEqual({
            ok: true,
            ownerName: '피확인 계정',
            targetName: '피확인장수',
        });

        await expect(
            db.inheritancePoint.findUniqueOrThrow({
                where: { userId_key: { userId: actorUserId, key: 'previous' } },
            })
        ).resolves.toMatchObject({ value: 500 });
        await expect(db.inheritanceLog.findMany({ where: { userId: actorUserId } })).resolves.toEqual([
            expect.objectContaining({
                year: 200,
                month: 4,
                text: '1000 포인트로 장수 소유자 확인',
            }),
        ]);

        const messages = await db.message.findMany({
            where: { mailbox: { in: [actorGeneralId, checkedGeneralId] } },
            orderBy: { mailbox: 'asc' },
        });
        expect(messages).toHaveLength(2);
        expect(
            messages.map(({ mailbox, type, src, dest, message }) => ({ mailbox, type, src, dest, message }))
        ).toEqual([
            {
                mailbox: actorGeneralId,
                type: 'private',
                src: 0,
                dest: actorGeneralId,
                message: expect.objectContaining({
                    src: expect.objectContaining({ generalId: 0, nationName: 'System' }),
                    dest: expect.objectContaining({ generalId: actorGeneralId, generalName: '확인장수' }),
                    text: '피확인장수의 소유자는 피확인 계정 입니다.',
                }),
            },
            {
                mailbox: checkedGeneralId,
                type: 'private',
                src: 0,
                dest: checkedGeneralId,
                message: expect.objectContaining({
                    src: expect.objectContaining({ generalId: 0, nationName: 'System' }),
                    dest: expect.objectContaining({ generalId: checkedGeneralId, generalName: '피확인장수' }),
                    text: '소유자명이 누군가에 의해 확인되었습니다.',
                }),
            },
        ]);

        await expect(
            db.inputEvent.findUniqueOrThrow({ where: { requestId: `${requestId}:inherit.checkOwner` } })
        ).resolves.toMatchObject({ status: 'SUCCEEDED', actorUserId });
        await expect(
            db.readModelRevision.findMany({
                where: { domain: 'messages.mailbox', entityId: { in: [actorGeneralId, checkedGeneralId] } },
                orderBy: { entityId: 'asc' },
            })
        ).resolves.toEqual([
            expect.objectContaining({ domain: 'messages.mailbox', entityId: actorGeneralId, revision: 1n }),
            expect.objectContaining({ domain: 'messages.mailbox', entityId: checkedGeneralId, revision: 1n }),
        ]);
    });
});
