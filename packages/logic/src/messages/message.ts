export type MessageType = 'public' | 'private' | 'national' | 'diplomacy';

export const MESSAGE_MAILBOX_PUBLIC = 9999;
export const MESSAGE_MAILBOX_NATIONAL_BASE = 9000;

export interface MessageTarget {
    generalId: number;
    generalName: string;
    nationId: number;
    nationName: string;
    color: string;
    icon: string;
}

export type MessageOption = Record<string, unknown>;

export interface MessageDraft {
    msgType: MessageType;
    src: MessageTarget;
    dest: MessageTarget;
    text: string;
    time: Date;
    validUntil: Date;
    option?: MessageOption | null;
}

export interface MessagePayload {
    src: MessageTarget;
    dest: MessageTarget;
    text: string;
    option?: MessageOption | null;
}

export interface MessageRecordDraft {
    mailbox: number;
    msgType: MessageType;
    srcId: number;
    destId: number;
    time: Date;
    validUntil: Date;
    payload: MessagePayload;
}

export interface MessageStore {
    insertMessage(draft: MessageRecordDraft): Promise<number>;
}

export const isValidMailbox = (mailbox: number): boolean => mailbox > 0 && mailbox <= MESSAGE_MAILBOX_PUBLIC;

export const resolveReceiverMailbox = (draft: MessageDraft): number => {
    switch (draft.msgType) {
        case 'public':
            return MESSAGE_MAILBOX_PUBLIC;
        case 'national':
        case 'diplomacy':
            return MESSAGE_MAILBOX_NATIONAL_BASE + draft.dest.nationId;
        case 'private':
            return draft.dest.generalId;
    }
};

export const resolveSenderMailbox = (draft: MessageDraft): number | null => {
    switch (draft.msgType) {
        case 'public':
            return null;
        case 'private':
            return draft.src.generalId !== draft.dest.generalId ? draft.src.generalId : null;
        case 'national':
            return draft.src.nationId !== draft.dest.nationId
                ? MESSAGE_MAILBOX_NATIONAL_BASE + draft.src.nationId
                : null;
        case 'diplomacy':
            return MESSAGE_MAILBOX_NATIONAL_BASE + draft.src.nationId;
    }
};

const buildPayload = (draft: MessageDraft, optionOverride?: MessageOption | null): MessagePayload => ({
    src: draft.src,
    dest: draft.dest,
    text: draft.text,
    option: optionOverride ?? draft.option ?? {},
});

const buildRecord = (
    draft: MessageDraft,
    mailbox: number,
    optionOverride?: MessageOption | null
): MessageRecordDraft => {
    const payload = buildPayload(draft, optionOverride);
    let srcId = draft.src.generalId;
    let destId = draft.dest.generalId;

    if (draft.msgType === 'public') {
        destId = MESSAGE_MAILBOX_PUBLIC;
    } else if (draft.msgType === 'national' || draft.msgType === 'diplomacy') {
        srcId = MESSAGE_MAILBOX_NATIONAL_BASE + draft.src.nationId;
        destId = MESSAGE_MAILBOX_NATIONAL_BASE + draft.dest.nationId;
    }

    return {
        mailbox,
        msgType: draft.msgType,
        srcId,
        destId,
        time: draft.time,
        validUntil: draft.validUntil,
        payload,
    };
};

const buildSenderOption = (draft: MessageDraft, receiverId: number): MessageOption => {
    const option = {
        ...(draft.option ?? {}),
        receiverMessageID: receiverId,
    };

    if (draft.msgType === 'diplomacy' && 'action' in option) {
        const { action: _action, ...rest } = option;
        return rest;
    }

    return option;
};

// 메시지 전달 규칙(수신/송신 복사본)을 그대로 유지한다.
export const sendMessage = async (
    store: MessageStore,
    draft: MessageDraft,
    options: { sendDestOnly?: boolean } = {}
): Promise<{ receiverId: number; senderId?: number }> => {
    const receiverMailbox = resolveReceiverMailbox(draft);
    if (!isValidMailbox(receiverMailbox)) {
        throw new Error(`Invalid receiver mailbox: ${receiverMailbox}`);
    }

    const receiverRecord = buildRecord(draft, receiverMailbox);
    const receiverId = await store.insertMessage(receiverRecord);
    if (!receiverId) {
        throw new Error('Failed to send receiver message.');
    }

    if (options.sendDestOnly) {
        return { receiverId };
    }

    const senderMailbox = resolveSenderMailbox(draft);
    if (!senderMailbox || senderMailbox === receiverMailbox) {
        return { receiverId };
    }

    const senderRecord = buildRecord(draft, senderMailbox, buildSenderOption(draft, receiverId));
    const senderId = await store.insertMessage(senderRecord);

    return senderId ? { receiverId, senderId } : { receiverId };
};
