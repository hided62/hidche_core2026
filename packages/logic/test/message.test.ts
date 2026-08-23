import { describe, expect, it } from 'vitest';

import {
    MESSAGE_MAILBOX_NATIONAL_BASE,
    MESSAGE_MAILBOX_PUBLIC,
    resolveMessageTargetIcon,
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

    it('clears the entire actionable diplomacy option from the sender copy', async () => {
        const store = new InMemoryMessageStore();
        const draft = buildDraft({
            msgType: 'diplomacy',
            option: { action: 'test', payload: 1 },
            dest: buildTarget({ generalId: 0, nationId: 2 }),
        });

        await sendMessage(store, draft);

        expect(store.records[1]!.draft.payload.option).toBeNull();
    });

    it('can persist only the receiver copy like Ref Message::send(true)', async () => {
        const store = new InMemoryMessageStore();
        const draft = buildDraft({ sendDestOnly: true });

        const result = await sendMessage(store, draft);

        expect(result).toEqual({ receiverId: 1 });
        expect(store.records).toHaveLength(1);
        expect(store.records[0]!.draft.mailbox).toBe(draft.dest.generalId);
    });
});

describe('resolveMessageTargetIcon', () => {
    it('uses the product shared origin by default and accepts an explicit differential origin', () => {
        expect(resolveMessageTargetIcon()).toBe('https://sam-image.hided.net/icons/default.jpg');
        expect(resolveMessageTargetIcon(null, 'https://dev-sam-ref.hided.net/image/icons/')).toBe(
            'https://dev-sam-ref.hided.net/image/icons/default.jpg'
        );
    });

    it('keeps a non-default shared picture and legacy user-icon marker visible', () => {
        expect(
            resolveMessageTargetIcon(
                { picture: '장수/관우.png', imageServer: 0 },
                'https://dev-sam-ref.hided.net/image/icons'
            )
        ).toBe('https://dev-sam-ref.hided.net/image/icons/장수/관우.png');
        expect(resolveMessageTargetIcon({ picture: 'users/custom.webp', imageServer: 1 })).toBe(
            'd_pic/users/custom.webp'
        );
    });
});
