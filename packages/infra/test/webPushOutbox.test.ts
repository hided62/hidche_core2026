import { describe, expect, it, vi } from 'vitest';

import type { GamePrismaClient } from '../src/gamePrisma.js';
import { enqueuePrivateMessageWebPush } from '../src/webPushOutbox.js';

describe('web push outbox event writer', () => {
    it('stores only a private receiver event without message content', async () => {
        const createMany = vi.fn().mockResolvedValue({ count: 1 });
        const db = {
            general: { findUnique: vi.fn().mockResolvedValue({ userId: '11111111-1111-4111-8111-111111111111' }) },
            webPushOutbox: { createMany },
        } as unknown as GamePrismaClient;

        await enqueuePrivateMessageWebPush(db, { msgType: 'private', mailbox: 8, destId: 8 }, 42);

        expect(createMany).toHaveBeenCalledWith({
            data: [
                {
                    eventId: 'message:42',
                    eventType: 'PRIVATE_MESSAGE_RECEIVED',
                    userIds: ['11111111-1111-4111-8111-111111111111'],
                },
            ],
            skipDuplicates: true,
        });
        expect(JSON.stringify(createMany.mock.calls)).not.toContain('message content');
    });

    it('does not notify for the sender copy or a non-private message', async () => {
        const findUnique = vi.fn();
        const createMany = vi.fn();
        const db = {
            general: { findUnique },
            webPushOutbox: { createMany },
        } as unknown as GamePrismaClient;

        await enqueuePrivateMessageWebPush(db, { msgType: 'private', mailbox: 3, destId: 8 }, 43);
        await enqueuePrivateMessageWebPush(db, { msgType: 'national', mailbox: 9001, destId: 9001 }, 44);

        expect(findUnique).not.toHaveBeenCalled();
        expect(createMany).not.toHaveBeenCalled();
    });
});
