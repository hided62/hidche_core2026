import { describe, expect, it } from 'vitest';

import {
    MESSAGE_MAILBOX_NATIONAL_BASE,
    MESSAGE_MAILBOX_PUBLIC,
    sendMessage,
    type MessageDraft,
    type MessageRecordDraft,
    type MessageStore,
    type MessageTarget,
} from '../src/messages/message.js';

const buildTarget = (overrides: Partial<MessageTarget> = {}): MessageTarget => ({
    generalId: 1,
    generalName: '테스트',
    nationId: 1,
    nationName: '나라',
    color: '#000000',
    icon: '',
    ...overrides,
});

class InMemoryMessageStore implements MessageStore {
    private nextId = 1;
    public readonly records: Array<{ id: number; draft: MessageRecordDraft }> = [];

    async insertMessage(draft: MessageRecordDraft): Promise<number> {
        const id = this.nextId++;
        this.records.push({ id, draft });
        return id;
    }
}

const buildDraft = (overrides: Partial<MessageDraft> = {}): MessageDraft => ({
    msgType: 'private',
    src: buildTarget({ generalId: 10, nationId: 1 }),
    dest: buildTarget({ generalId: 20, nationId: 2 }),
    text: '안녕',
    time: new Date('2025-01-01T00:00:00Z'),
    validUntil: new Date('9999-12-31T00:00:00Z'),
    option: {},
    ...overrides,
});

describe('sendMessage', () => {
    it('sends a private message to receiver and sender', async () => {
        const store = new InMemoryMessageStore();
        const draft = buildDraft();

        const result = await sendMessage(store, draft);

        expect(result.receiverId).toBe(1);
        expect(result.senderId).toBe(2);
        expect(store.records).toHaveLength(2);
        expect(store.records[0]!.draft.mailbox).toBe(draft.dest.generalId);
        expect(store.records[1]!.draft.mailbox).toBe(draft.src.generalId);
        expect(store.records[0]!.draft.payload.option).not.toHaveProperty('receiverMessageID');
        expect(store.records[1]!.draft.payload.option).toMatchObject({
            receiverMessageID: 1,
        });
    });

    it('sends only one national message when nations match', async () => {
        const store = new InMemoryMessageStore();
        const draft = buildDraft({
            msgType: 'national',
            dest: buildTarget({ generalId: 0, nationId: 1 }),
        });

        const result = await sendMessage(store, draft);

        expect(result.senderId).toBeUndefined();
        expect(store.records).toHaveLength(1);
        expect(store.records[0]!.draft.mailbox).toBe(MESSAGE_MAILBOX_NATIONAL_BASE + 1);
    });

    it('keeps public messages in the shared mailbox only', async () => {
        const store = new InMemoryMessageStore();
        const draft = buildDraft({
            msgType: 'public',
            dest: buildTarget({ generalId: 0, nationId: 0 }),
        });

        const result = await sendMessage(store, draft);

        expect(result.senderId).toBeUndefined();
        expect(store.records).toHaveLength(1);
        expect(store.records[0]!.draft.mailbox).toBe(MESSAGE_MAILBOX_PUBLIC);
    });

    it('removes diplomacy action from sender copy', async () => {
        const store = new InMemoryMessageStore();
        const draft = buildDraft({
            msgType: 'diplomacy',
            option: { action: 'test', payload: 1 },
            dest: buildTarget({ generalId: 0, nationId: 2 }),
        });

        await sendMessage(store, draft);

        const senderPayload = store.records[1]!.draft.payload.option ?? {};
        expect(senderPayload).not.toHaveProperty('action');
        expect(senderPayload).toMatchObject({ payload: 1 });
    });
});
