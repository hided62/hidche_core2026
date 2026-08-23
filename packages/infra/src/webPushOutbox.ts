import type { WebPushEventType } from '@sammo-ts/common';

import type { GamePrisma } from './gamePrisma.js';

export type WebPushOutboxDatabase = Pick<GamePrisma.TransactionClient, 'general' | 'webPushOutbox'>;

export interface WebPushOutboxEventInput {
    eventId: string;
    eventType: WebPushEventType;
    userIds?: readonly string[];
    year?: number;
    month?: number;
}

const uniqueUserIds = (values: readonly string[]): string[] => [...new Set(values.filter(Boolean))].sort();

export const enqueueWebPushOutboxEvents = async (
    db: WebPushOutboxDatabase,
    events: readonly WebPushOutboxEventInput[]
): Promise<number> => {
    if (events.length === 0) return 0;
    const result = await db.webPushOutbox.createMany({
        data: events.map((event) => ({
            eventId: event.eventId,
            eventType: event.eventType,
            userIds: uniqueUserIds(event.userIds ?? []),
            ...(event.year === undefined ? {} : { year: event.year }),
            ...(event.month === undefined ? {} : { month: event.month }),
        })),
        skipDuplicates: true,
    });
    return result.count;
};

export const enqueuePrivateMessageWebPush = async (
    db: WebPushOutboxDatabase,
    draft: { msgType: string; mailbox: number; destId: number },
    messageId: number
): Promise<void> => {
    if (draft.msgType !== 'private' || draft.mailbox !== draft.destId) return;
    const recipient = await db.general.findUnique({
        where: { id: draft.destId },
        select: { userId: true },
    });
    if (!recipient?.userId) return;
    await enqueueWebPushOutboxEvents(db, [
        {
            eventId: `message:${messageId}`,
            eventType: 'PRIVATE_MESSAGE_RECEIVED',
            userIds: [recipient.userId],
        },
    ]);
};
