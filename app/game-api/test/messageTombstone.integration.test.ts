import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { tombstoneMessages } from '../src/messages/store.js';

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
});
