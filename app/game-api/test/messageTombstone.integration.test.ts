import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, persistMessageEnvelope, type GamePrismaClient } from '@sammo-ts/infra';

import { tombstoneMessages, tombstoneMessagesWithinDeleteWindow } from '../src/messages/store.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration('message deletion tombstone persistence', () => {
    let db: GamePrismaClient;
    let close: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const schema = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') : null;
        if (!schema?.endsWith('conditional_integration')) {
            throw new Error(`Unsafe schema: ${schema ?? '(missing)'}`);
        }
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
    });

    afterAll(async () => close?.());

    it('persists an ordinary wall-time envelope without creating a game action', async () => {
        const rollback = new Error('rollback ordinary message envelope fixture');
        await expect(
            db.$transaction(async (transaction) => {
                const target = {
                    generalId: 7,
                    generalName: '보낸이',
                    nationId: 0,
                    nationName: '재야',
                    color: '#000000',
                    icon: '',
                };
                const id = await persistMessageEnvelope(
                    transaction,
                    {
                        mailbox: 9999,
                        msgType: 'public',
                        srcId: target.generalId,
                        destId: 9999,
                        time: new Date('0200-01-01T00:00:00.000Z'),
                        validUntil: new Date('9999-12-31T00:00:00.000Z'),
                        payload: {
                            src: target,
                            dest: target,
                            text: '일반 메시지는 WALL_TIME envelope만 저장한다.',
                            option: {},
                        },
                    },
                    null
                );

                const message = await transaction.message.findUniqueOrThrow({
                    where: { id },
                    include: { action: true },
                });
                expect(message.createdAtWall).toBeInstanceOf(Date);
                expect(message.deleteUntilWall.getTime() - message.createdAtWall.getTime()).toBe(5 * 60_000);
                expect(message.occurredGameTick).toBeNull();
                expect(message.action).toBeNull();

                throw rollback;
            })
        ).rejects.toBe(rollback);
    });

    it('keeps sender and receiver rows readable while replacing their bodies', async () => {
        const rollback = new Error('rollback message tombstone fixture');
        await expect(
            db.$transaction(async (transaction) => {
                const validUntil = new Date('9999-12-31T00:00:00.000Z');
                const receiver = await transaction.message.create({
                    data: {
                        mailbox: 8,
                        type: 'private',
                        src: 7,
                        dest: 8,
                        time: new Date('2026-08-24T00:00:00.000Z'),
                        validUntil,
                        message: {
                            src: { generalId: 7 },
                            dest: { generalId: 8 },
                            text: '수신 사본 원문',
                            option: { senderMessageID: 0 },
                        },
                    },
                });
                const sender = await transaction.message.create({
                    data: {
                        mailbox: 7,
                        type: 'private',
                        src: 7,
                        dest: 8,
                        time: new Date('2026-08-24T00:00:00.000Z'),
                        validUntil,
                        message: {
                            src: { generalId: 7 },
                            dest: { generalId: 8 },
                            text: '송신 사본 원문',
                            option: { receiverMessageID: receiver.id },
                        },
                    },
                });

                await tombstoneMessages(transaction, [sender.id, receiver.id]);

                const rows = await transaction.message.findMany({
                    where: { id: { in: [sender.id, receiver.id] } },
                    orderBy: { id: 'asc' },
                });
                expect(rows).toHaveLength(2);
                for (const row of rows) {
                    expect(row.validUntil).toEqual(validUntil);
                    expect(row.tombstonedAtWall).not.toBeNull();
                    expect(row.message).toMatchObject({
                        text: '삭제된 메시지입니다.',
                        option: { invalid: true },
                    });
                    expect(JSON.stringify(row.message)).not.toContain('사본 원문');
                }

                throw rollback;
            })
        ).rejects.toBe(rollback);
    });

    it('uses the DB wall deadline even when the game clock is not advancing', async () => {
        const rollback = new Error('rollback wall deletion fixture');
        await expect(
            db.$transaction(async (transaction) => {
                const [{ now_wall: nowWall }] = await transaction.$queryRaw<Array<{ now_wall: Date }>>`
                    SELECT CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AS now_wall
                `;
                const draft = (text: string) => ({
                    mailbox: 7,
                    type: 'private' as const,
                    src: 7,
                    dest: 8,
                    time: new Date('0200-01-01T00:00:00.000Z'),
                    validUntil: new Date('9999-12-31T00:00:00.000Z'),
                    createdAtWall: nowWall,
                    message: {
                        src: { generalId: 7 },
                        dest: { generalId: 8 },
                        text,
                        option: {},
                    },
                });
                const deletable = await transaction.message.create({
                    data: { ...draft('future wall deadline'), deleteUntilWall: new Date(nowWall.getTime() + 60_000) },
                });
                const expired = await transaction.message.create({
                    data: { ...draft('past wall deadline'), deleteUntilWall: new Date(nowWall.getTime() - 60_000) },
                });

                expect(
                    await tombstoneMessagesWithinDeleteWindow(transaction, deletable.id, [deletable.id])
                ).toEqual([deletable.id]);
                expect(await tombstoneMessagesWithinDeleteWindow(transaction, expired.id, [expired.id])).toEqual([]);

                throw rollback;
            })
        ).rejects.toBe(rollback);
    });
});
